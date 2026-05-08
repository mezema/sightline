import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Feedback, ProcessingAttempt } from "@sightline/core";
import type { InspectionView } from "./types";
import type {
  CancelPayload,
  CompleteUploadsPayload,
  CreateInspectionPayload,
  CreateUploadSessionPayload,
  DeletePayload,
  FeedbackPayload,
  InspectionWorkflowRepository,
  RetryPayload,
  UploadSession,
} from "./repository-contract";
import { advanceInspection, completeAttempt, counterPatch, devOwnerUserId, makeInitialAttempts, makeTargets } from "./fake-workflow";

const dataPath = join(process.cwd(), ".sightline-data", "inspections.json");

type Store = {
  inspections: InspectionView[];
};

export const devRepository: InspectionWorkflowRepository = {
  listInspections,
  getInspection,
  createInspection,
  createUploadSession,
  completeUploads,
  createFeedback,
  retryTarget,
  cancelInspection,
  deleteInspection,
};

const pendingUploadSessions = new Map<string, CreateUploadSessionPayload>();

async function listInspections() {
  const store = await readStore();
  return store.inspections
    .map((inspection) => ({ ...inspection, ...counterPatch(inspection) }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function getInspection(id: string) {
  const store = await readStore();
  const inspection = store.inspections.find((item) => item.id === id);
  if (!inspection) return undefined;
  if (inspection.status === "processing") {
    await advanceInspection(inspection);
    await writeStore(store);
  }
  return { ...inspection, ...counterPatch(inspection) };
}

async function createInspection(input: CreateInspectionPayload) {
  const store = await readStore();
  const now = new Date().toISOString();
  const id = randomUUID();
  const targets = makeTargets({ inspectionId: id, createdAt: now, filenames: input.targetFilenames });
  const attempts = makeInitialAttempts({ inspectionId: id, targets, createdAt: now });

  const inspection: InspectionView = {
    id,
    ownerUserId: devOwnerUserId,
    defectSpecId: randomUUID(),
    status: "processing",
    targetCount: targets.length,
    processedCount: 0,
    failedCount: 0,
    defectCount: 0,
    createdAt: now,
    submittedAt: now,
    description: input.description.trim() || "surface crack like the reference image",
    referenceImage: {
      originalFilename: input.referenceFilename || "reference-crack.jpg",
      url: "/sample-reference.svg",
      width: 256,
      height: 180,
    },
    targets,
    attempts,
    results: [],
    detections: [],
    feedback: [],
    events: [],
  };

  store.inspections.unshift(inspection);
  await advanceInspection(inspection);
  await writeStore(store);
  return { ...inspection, ...counterPatch(inspection) };
}

async function createUploadSession(input: CreateUploadSessionPayload): Promise<UploadSession> {
  const inspectionId = randomUUID();
  pendingUploadSessions.set(inspectionId, input);
  return {
    inspectionId,
    uploads: [
      {
        imageAssetId: randomUUID(),
        kind: "reference",
        uploadUrl: "/api/uploads/dev-reference",
        method: "PUT",
        headers: uploadHeaders(input.reference.mimeType),
      },
      ...input.targets.map((target) => ({
        imageAssetId: randomUUID(),
        kind: "target" as const,
        uploadUrl: "/api/uploads/dev-target",
        method: "PUT" as const,
        headers: uploadHeaders(target.mimeType),
      })),
    ],
  };
}

function uploadHeaders(mimeType: string | undefined): Record<string, string> {
  return mimeType ? { "content-type": mimeType } : {};
}

async function completeUploads(input: CompleteUploadsPayload) {
  const session = pendingUploadSessions.get(input.inspectionId);
  if (!session) throw new Error("Upload session not found.");
  pendingUploadSessions.delete(input.inspectionId);
  return createInspection({
    description: session.description,
    referenceFilename: session.reference.filename,
    targetFilenames: session.targets.map((target) => target.filename),
  });
}

async function createFeedback(input: FeedbackPayload) {
  const store = await readStore();
  const inspection = requireInspection(store, input.inspectionId);
  const target = inspection.targets.find((item) => item.id === input.targetId);
  if (!target) throw new Error("Target not found.");
  const result = inspection.results.find((item) => item.id === target.latestResultId);
  const feedback: Feedback = {
    id: randomUUID(),
    inspectionId: inspection.id,
    inspectionTargetId: target.id,
    subjectType: result ? "result" : "target",
    subjectId: result?.id,
    verdict: input.verdict,
    createdByUserId: devOwnerUserId,
    createdAt: new Date().toISOString(),
  };
  inspection.feedback.push(feedback);
  Object.assign(inspection, counterPatch(inspection));
  await writeStore(store);
  return { ...inspection, ...counterPatch(inspection) };
}

async function deleteInspection(input: DeletePayload) {
  const store = await readStore();
  store.inspections = store.inspections.filter((item) => item.id !== input.inspectionId);
  await writeStore(store);
}

async function cancelInspection(input: CancelPayload) {
  const store = await readStore();
  const inspection = requireInspection(store, input.inspectionId);
  if (inspection.status !== "processing" && inspection.status !== "queued") {
    return { ...inspection, ...counterPatch(inspection) };
  }
  const now = new Date().toISOString();
  for (const attempt of inspection.attempts) {
    if (attempt.status === "pending" || attempt.status === "queued" || attempt.status === "running") {
      attempt.status = "cancelled";
      attempt.completedAt = now;
    }
  }
  inspection.status = "cancelled";
  inspection.cancelledAt = now;
  inspection.completedAt = now;
  inspection.events.push({
    id: randomUUID(),
    inspectionId: inspection.id,
    actorUserId: devOwnerUserId,
    kind: "inspection_cancelled",
    payload: {},
    createdAt: now,
  });
  Object.assign(inspection, counterPatch(inspection));
  await writeStore(store);
  return { ...inspection, ...counterPatch(inspection) };
}

async function retryTarget(input: RetryPayload) {
  const store = await readStore();
  const inspection = requireInspection(store, input.inspectionId);
  const target = inspection.targets.find((item) => item.id === input.targetId);
  if (!target) throw new Error("Target not found.");
  const attemptCount = inspection.attempts.filter((attempt) => attempt.inspectionTargetId === target.id).length;
  const attempt: ProcessingAttempt = {
    id: randomUUID(),
    inspectionId: inspection.id,
    inspectionTargetId: target.id,
    status: "running",
    attempt: attemptCount + 1,
    idempotencyKey: `${inspection.id}:${target.id}:fake:${attemptCount + 1}`,
    startedAt: new Date().toISOString(),
  };
  inspection.status = "processing";
  inspection.completedAt = undefined;
  target.latestAttemptId = attempt.id;
  inspection.attempts.push(attempt);
  await advanceInspection(inspection);
  await writeStore(store);
  return { ...inspection, ...counterPatch(inspection) };
}

async function readStore(): Promise<Store> {
  try {
    return JSON.parse(await readFile(dataPath, "utf8"));
  } catch {
    const store = { inspections: [seedInspection()] };
    await writeStore(store);
    return store;
  }
}

async function writeStore(store: Store) {
  await mkdir(dirname(dataPath), { recursive: true });
  await writeFile(dataPath, `${JSON.stringify(store, null, 2)}\n`);
}

function requireInspection(store: Store, id: string) {
  const inspection = store.inspections.find((item) => item.id === id);
  if (!inspection) throw new Error("Inspection not found.");
  return inspection;
}

function seedInspection(): InspectionView {
  const inspection = makeSeedInspection();
  for (const attempt of [...inspection.attempts]) completeAttempt(inspection, attempt);
  Object.assign(inspection, counterPatch(inspection));
  return inspection;
}

function makeSeedInspection(): InspectionView {
  const now = "2026-05-08T11:20:00.000Z";
  const id = randomUUID();
  const targets = makeTargets({ inspectionId: id, createdAt: now });
  return {
    id,
    ownerUserId: devOwnerUserId,
    defectSpecId: randomUUID(),
    status: "processing",
    targetCount: targets.length,
    processedCount: 0,
    failedCount: 0,
    defectCount: 0,
    createdAt: now,
    submittedAt: now,
    description: "surface crack like the reference image",
    referenceImage: {
      originalFilename: "reference-crack.jpg",
      url: "/sample-reference.svg",
      width: 256,
      height: 180,
    },
    targets,
    attempts: makeInitialAttempts({ inspectionId: id, targets, createdAt: now }).map((attempt) => ({ ...attempt, status: "running" })),
    results: [],
    detections: [],
    feedback: [],
    events: [],
  };
}
