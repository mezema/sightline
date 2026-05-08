import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { GeminiAnalyzer } from "./analyzers/gemini.ts";
import type { AnalyzerResult } from "./analyzers/DefectAnalyzer.ts";
import { writeReports } from "./report.ts";
import { mimeTypeForPath } from "./lib/files.ts";
import { deriveJobStatus, summarizeJob, type InspectionJob, type JobImage } from "./prototype/job.ts";
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
