import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { GeminiAnalyzer } from "./analyzers/gemini.ts";
import type { AnalyzerResult } from "./analyzers/DefectAnalyzer.ts";
import { writeReports } from "./report.ts";
import { mimeTypeForPath } from "./lib/files.ts";
import { deriveJobStatus, summarizeJob, type Feedback, type InspectionJob, type JobImage } from "./prototype/job.ts";
import { parseMultipart, type MultipartFile } from "./prototype/multipart.ts";

const root = process.cwd();
const uploadsDir = resolve(root, "uploads");
const jobsDir = resolve(root, "jobs");
const port = Number(process.env.PORT ?? 4173);
const maxTargets = 25;

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function main() {
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(jobsDir, { recursive: true });

  createServer(handleRequest).listen(port, () => {
    console.log(`Sightline prototype: http://localhost:${port}/prototype/`);
  });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `localhost:${port}`}`);

    if (request.method === "POST" && url.pathname === "/api/jobs") {
      await createJob(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      await getJob(url.pathname.split("/").at(-1) ?? "", response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/jobs") {
      await listJobs(response);
      return;
    }

    if (request.method === "POST" && url.pathname.match(/^\/api\/jobs\/[^/]+\/feedback$/)) {
      await createFeedback(url.pathname.split("/")[3], request, response);
      return;
    }

    if (request.method === "POST" && url.pathname.match(/^\/api\/jobs\/[^/]+\/retry$/)) {
      await retryTarget(url.pathname.split("/")[3], request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sample-inspection") {
      await createSampleInspection(response);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function createJob(request: IncomingMessage, response: ServerResponse) {
  const body = await readRequestBody(request);
  const form = parseMultipart(body, request.headers["content-type"]);
  const description = form.fields.get("description")?.trim() ?? "";
  const reference = form.files.find((file) => file.fieldName === "reference");
  const targets = form.files.filter((file) => file.fieldName === "targets" && file.filename);

  validateJobInput(description, reference, targets);

  const jobId = `job_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
  const jobUploadDir = join(uploadsDir, jobId);
  const referenceDir = join(jobUploadDir, "reference");
  const targetsDir = join(jobUploadDir, "targets");
  await mkdir(referenceDir, { recursive: true });
  await mkdir(targetsDir, { recursive: true });

  const referenceImage = await saveUploadedImage(reference!, referenceDir, `/uploads/${jobId}/reference`);
  const targetImages: JobImage[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    targetImages.push(await saveUploadedImage(targets[index], targetsDir, `/uploads/${jobId}/targets`, `target-${String(index + 1).padStart(2, "0")}`));
  }

  const job: InspectionJob = {
    id: jobId,
    status: "processing",
    description,
    referenceImage,
    targetImages,
    results: [],
    feedback: [],
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };

  await writeJob(job);
  void processJob(job).catch(async (error) => {
    const failedJob = await readJob(job.id).catch(() => job);
    failedJob.status = failedJob.results.length > 0 ? "partially_failed" : "failed";
    failedJob.error = error instanceof Error ? error.message : String(error);
    failedJob.completedAt = new Date().toISOString();
    await writeJob(failedJob);
  });

  sendJson(response, 201, { jobId, job, summary: summarizeJob(job) });
}

async function processJob(job: InspectionJob) {
  const analyzer = new GeminiAnalyzer();
  const results: AnalyzerResult[] = [];

  for (const target of job.targetImages) {
    const current = await readJob(job.id);
    const result = await analyzer.analyze({
      referenceImagePath: job.referenceImage.path,
      targetImagePath: target.path,
      defectDescription: job.description,
      idempotencyKey: `${job.id}:${target.id}:gemini:v1`,
    });
    result.targetImage = basename(target.path);
    results.push(result);

    current.results = results;
    current.status = deriveJobStatus(job.targetImages.length, results);
    if (current.status !== "processing") current.completedAt = new Date().toISOString();
    await writeJob(current);
  }

  const finished = await readJob(job.id);
  finished.results = results;
  finished.status = deriveJobStatus(job.targetImages.length, results);
  finished.completedAt = new Date().toISOString();
  await writeJob(finished);
  await writeReports(results, join(jobsDir, job.id, "outputs"));
}

async function getJob(jobId: string, response: ServerResponse) {
  const job = await readJob(jobId);
  sendJson(response, 200, { job, summary: summarizeJob(job) });
}

async function createFeedback(jobId: string, request: IncomingMessage, response: ServerResponse) {
  const payload = JSON.parse((await readRequestBody(request)).toString("utf8"));
  if (payload.kind !== "confirm" && payload.kind !== "reject") throw new Error("Feedback kind must be confirm or reject.");
  const job = await readJob(jobId);
  const target = job.targetImages.find((image) => image.id === payload.targetImageId);
  if (!target) throw new Error("Target image not found.");

  const feedback: Feedback = {
    id: randomUUID(),
    targetImageId: target.id,
    resultTargetImage: basename(target.path),
    kind: payload.kind,
    createdAt: new Date().toISOString(),
  };
  job.feedback = [...(job.feedback ?? []), feedback];
  await writeJob(job);
  sendJson(response, 201, { job, summary: summarizeJob(job), feedback });
}

async function retryTarget(jobId: string, request: IncomingMessage, response: ServerResponse) {
  const payload = JSON.parse((await readRequestBody(request)).toString("utf8"));
  const job = await readJob(jobId);
  const target = job.targetImages.find((image) => image.id === payload.targetImageId);
  if (!target) throw new Error("Target image not found.");

  job.status = "processing";
  job.completedAt = undefined;
  await writeJob(job);
  sendJson(response, 202, { job, summary: summarizeJob(job) });

  void processSingleTarget(job.id, target.id).catch(async (error) => {
    const failedJob = await readJob(job.id);
    failedJob.error = error instanceof Error ? error.message : String(error);
    failedJob.status = deriveJobStatus(failedJob.targetImages.length, failedJob.results);
    failedJob.completedAt = new Date().toISOString();
    await writeJob(failedJob);
  });
}

async function processSingleTarget(jobId: string, targetImageId: string) {
  const job = await readJob(jobId);
  const target = job.targetImages.find((image) => image.id === targetImageId);
  if (!target) throw new Error("Target image not found.");
  const analyzer = new GeminiAnalyzer();
  const result = await analyzer.analyze({
    referenceImagePath: job.referenceImage.path,
    targetImagePath: target.path,
    defectDescription: job.description,
    idempotencyKey: `${job.id}:${target.id}:gemini:retry:${Date.now()}`,
  });
  result.targetImage = basename(target.path);
  (result as AnalyzerResult & { attemptId?: string }).attemptId = randomUUID();

  const current = await readJob(job.id);
  current.results = [...current.results.filter((item) => item.targetImage !== result.targetImage), result];
  current.status = deriveJobStatus(current.targetImages.length, current.results);
  current.completedAt = current.status === "processing" ? undefined : new Date().toISOString();
  await writeJob(current);
  await writeReports(current.results, join(jobsDir, job.id, "outputs"));
}

async function createSampleInspection(response: ServerResponse) {
  const indexPath = join(jobsDir, "index.json");
  const index = await readFile(indexPath, "utf8").then(JSON.parse).catch(() => []);
  const existing = index.find((entry: { description?: string }) => entry.description === "sample: surface crack like the reference image");
  if (existing) {
    const job = await readJob(existing.id);
    sendJson(response, 200, { jobId: job.id, job, summary: summarizeJob(job) });
    return;
  }

  const jobId = `job_sample_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const referenceDir = join(uploadsDir, jobId, "reference");
  const targetsDir = join(uploadsDir, jobId, "targets");
  await mkdir(referenceDir, { recursive: true });
  await mkdir(targetsDir, { recursive: true });

  const referencePath = join(referenceDir, "reference.jpg");
  await cp(resolve(root, "samples/reference/reference-crack.jpg"), referencePath);
  const referenceImage: JobImage = {
    id: randomUUID(),
    originalFilename: "reference-crack.jpg",
    path: referencePath,
    url: `/uploads/${jobId}/reference/reference.jpg`,
    mimeType: "image/jpeg",
    byteSize: (await readFile(referencePath)).byteLength,
  };

  const targetImages: JobImage[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const file = `target-crack-0${index}.jpg`;
    const destName = `target-${String(index).padStart(2, "0")}.jpg`;
    const dest = join(targetsDir, destName);
    await cp(resolve(root, `samples/targets/${file}`), dest);
    targetImages.push({
      id: randomUUID(),
      originalFilename: file,
      path: dest,
      url: `/uploads/${jobId}/targets/${destName}`,
      mimeType: "image/jpeg",
      byteSize: (await readFile(dest)).byteLength,
    });
  }

  const job: InspectionJob = {
    id: jobId,
    status: "processing",
    description: "sample: surface crack like the reference image",
    referenceImage,
    targetImages,
    results: [],
    feedback: [],
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
  await writeJob(job);
  void processJob(job);
  sendJson(response, 201, { jobId, job, summary: summarizeJob(job) });
}

async function listJobs(response: ServerResponse) {
  const indexPath = join(jobsDir, "index.json");
  const index = await readFile(indexPath, "utf8").then(JSON.parse).catch(() => []);
  const hydrated = await Promise.all(index.map(async (entry: { id: string; referenceImage?: unknown }) => {
    if (entry.referenceImage) return entry;
    return hydrateJobIndexEntry(entry);
  }));
  sendJson(response, 200, { jobs: hydrated });
}

async function saveUploadedImage(file: MultipartFile, directory: string, urlPrefix: string, namePrefix = "reference"): Promise<JobImage> {
  const extension = normalizeImageExtension(file.filename, file.contentType);
  const filename = `${namePrefix}${extension}`;
  const path = join(directory, filename);
  await writeFile(path, file.data);

  return {
    id: randomUUID(),
    originalFilename: file.filename,
    path,
    url: `${urlPrefix}/${filename}`,
    mimeType: file.contentType,
    byteSize: file.data.byteLength,
  };
}

function validateJobInput(description: string, reference: MultipartFile | undefined, targets: MultipartFile[]) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run inspections.");
  if (!description) throw new Error("Defect description is required.");
  if (!reference?.filename) throw new Error("Exactly one reference image is required.");
  if (targets.length === 0) throw new Error("At least one target image is required.");
  if (targets.length > maxTargets) throw new Error(`No more than ${maxTargets} target images are allowed.`);
  for (const file of [reference, ...targets]) {
    if (!file.contentType.startsWith("image/")) throw new Error(`${file.filename} is not an image.`);
  }
}

async function readJob(jobId: string): Promise<InspectionJob> {
  return JSON.parse(await readFile(join(jobsDir, jobId, "job.json"), "utf8"));
}

async function writeJob(job: InspectionJob) {
  const jobDir = join(jobsDir, job.id);
  await mkdir(jobDir, { recursive: true });
  await writeFile(join(jobDir, "job.json"), `${JSON.stringify(job, null, 2)}\n`);
  await updateJobIndex(job);
}

async function updateJobIndex(job: InspectionJob) {
  const indexPath = join(jobsDir, "index.json");
  const index = await readFile(indexPath, "utf8").then(JSON.parse).catch(() => []);
  const item = {
    id: job.id,
    status: job.status,
    description: job.description,
    referenceImage: {
      originalFilename: job.referenceImage.originalFilename,
      url: job.referenceImage.url,
    },
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    summary: summarizeJob(job),
  };
  const next = [item, ...index.filter((entry: { id: string }) => entry.id !== job.id)].slice(0, 50);
  await writeFile(indexPath, `${JSON.stringify(next, null, 2)}\n`);
}

async function hydrateJobIndexEntry(entry: { id: string }) {
  try {
    const job = await readJob(entry.id);
    return {
      id: job.id,
      status: job.status,
      description: job.description,
      referenceImage: {
        originalFilename: job.referenceImage.originalFilename,
        url: job.referenceImage.url,
      },
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      summary: summarizeJob(job),
    };
  } catch {
    return entry;
  }
}

async function serveStatic(pathname: string, response: ServerResponse) {
  let normalizedPath = decodeURIComponent(pathname);
  if (normalizedPath === "/") normalizedPath = "/prototype/index.html";
  if (normalizedPath === "/prototype/") normalizedPath = "/prototype/index.html";
  if (normalizedPath === "/review/") normalizedPath = "/review/index.html";

  const filePath = resolve(root, `.${normalizedPath}`);
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }

  const data = await readFile(filePath);
  response.writeHead(200, { "content-type": contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
  response.end(data);
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function normalizeImageExtension(filename: string, contentType: string): string {
  const extension = extname(filename).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) return extension;
  const fromMime = contentType.split("/").at(1);
  if (fromMime === "jpeg") return ".jpg";
  if (fromMime) return `.${fromMime}`;
  return extname(mimeTypeForPath(filename));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
