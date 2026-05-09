import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { createDb, defectSpecs, detections, feedback, imageAssets, inspectionEvents, inspectionResults, inspections, inspectionTargets, processingAttempts, users } from "@sightline/db";
import { rebuildInspectionCounters } from "@sightline/db/fake-processing";
import type { Detection, Feedback, InspectionResult, JobEvent, ObjectStorage, ProcessingAttempt } from "@sightline/core";
import type { InspectionView, ReviewTarget } from "./types";
import type {
  CancelPayload,
  CompleteUploadsPayload,
  CreateInspectionPayload,
  CreateUploadSessionPayload,
  DeletePayload,
  FeedbackPayload,
  InspectionWorkflowRepository,
  JobQueue,
  RetryPayload,
} from "./repository-contract";
import type { RequestOwner } from "./auth";
import { getRequestOwner } from "./auth";
import { counterPatch, devOwnerUserId, makeInitialAttempts, makeTargets } from "./fake-workflow";

type Db = ReturnType<typeof createDb>;

export function createDrizzleInspectionRepository(
  databaseUrl = process.env.DATABASE_URL,
  storage?: ObjectStorage,
  jobQueue?: JobQueue,
  getOwner: () => Promise<RequestOwner> = getRequestOwner,
): InspectionWorkflowRepository {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the Drizzle repository.");
  const db = createDb(databaseUrl);
  return {
    listInspections: async () => listInspections(db, await ensureUser(db, await getOwner())),
    getInspection: async (id) => getInspection(db, id, await ensureUser(db, await getOwner())),
    createInspection: async (input) => createInspection(db, await ensureUser(db, await getOwner()), jobQueue, input),
    createUploadSession: async (input) => createUploadSession(db, await ensureUser(db, await getOwner()), storage, input),
    completeUploads: async (input) => completeUploads(db, await ensureUser(db, await getOwner()), storage, jobQueue, input),
    createFeedback: async (input) => createFeedback(db, await ensureUser(db, await getOwner()), input),
    retryTarget: async (input) => retryTarget(db, await ensureUser(db, await getOwner()), jobQueue, input),
    cancelInspection: async (input) => cancelInspection(db, await ensureUser(db, await getOwner()), input),
    deleteInspection: async (input) => deleteInspection(db, await ensureUser(db, await getOwner()), input),
  };
}

async function listInspections(db: Db, owner: { id: string }) {
  const rows = await db.select().from(inspections).where(eq(inspections.ownerUserId, owner.id)).orderBy(desc(inspections.createdAt));
  const views = await Promise.all(rows.map((row) => hydrateInspection(db, row.id)));
  return views.filter((view): view is InspectionView => view !== undefined && shouldListInspection(view));
}

async function getInspection(db: Db, id: string, owner: { id: string }) {
  const view = await hydrateInspection(db, id);
  if (view && view.ownerUserId !== owner.id) return undefined;
  return view ? { ...view, ...counterPatch(view) } : undefined;
}

async function createInspection(db: Db, owner: { id: string }, jobQueue: JobQueue | undefined, input: CreateInspectionPayload) {
  const now = new Date();
  const nowIso = now.toISOString();
  const inspectionId = randomUUID();
  const defectSpecId = randomUUID();
  const referenceImageId = randomUUID();
  const targets = makeTargets({ inspectionId, createdAt: nowIso, filenames: input.targetFilenames });
  const attempts = makeInitialAttempts({ inspectionId, targets, createdAt: nowIso });

  await db.insert(inspections).values({
    id: inspectionId,
    ownerUserId: owner.id,
    status: "processing",
    targetCount: targets.length,
    processedCount: 0,
    failedCount: 0,
    defectCount: 0,
    createdAt: now,
    submittedAt: now,
  });

  await db.insert(imageAssets).values({
    id: referenceImageId,
    ownerUserId: owner.id,
    inspectionId,
    kind: "reference",
    storageKey: `/sample-reference.svg?inspection=${inspectionId}`,
    originalFilename: input.referenceFilename || "reference-crack.jpg",
    mimeType: "image/svg+xml",
    byteSize: 1,
    width: 256,
    height: 180,
    uploadStatus: "verified",
    createdAt: now,
  });

  await db.insert(defectSpecs).values({
    id: defectSpecId,
    ownerUserId: owner.id,
    inspectionId,
    referenceImageId,
    description: input.description.trim() || "surface crack like the reference image",
    createdAt: now,
  });

  await db.update(inspections).set({ defectSpecId }).where(eq(inspections.id, inspectionId));

  for (const target of targets) {
    await db.insert(imageAssets).values({
      id: target.targetImageId,
      ownerUserId: owner.id,
      inspectionId,
      kind: "target",
      storageKey: `${target.image.url}?inspection=${inspectionId}`,
      originalFilename: target.image.originalFilename,
      mimeType: "image/svg+xml",
      byteSize: 1,
      width: target.image.width,
      height: target.image.height,
      uploadStatus: "verified",
      createdAt: new Date(target.createdAt),
    });
    await db.insert(inspectionTargets).values({
      id: target.id,
      inspectionId,
      targetImageId: target.targetImageId,
      position: target.position,
      createdAt: new Date(target.createdAt),
    });
  }

  await db.insert(processingAttempts).values(
    attempts.map((attempt) => ({
      id: attempt.id,
      inspectionId: attempt.inspectionId,
      inspectionTargetId: attempt.inspectionTargetId,
      status: attempt.status,
      attempt: attempt.attempt,
      idempotencyKey: attempt.idempotencyKey,
      startedAt: attempt.startedAt ? new Date(attempt.startedAt) : undefined,
    })),
  );

  for (const target of targets) {
    await db.update(inspectionTargets).set({ latestAttemptId: target.latestAttemptId }).where(eq(inspectionTargets.id, target.id));
  }

  await db.insert(inspectionEvents).values({
    inspectionId,
    actorUserId: owner.id,
    kind: "inspection_created",
    payload: { mode: "fake-db" },
    createdAt: now,
  });

  await jobQueue?.enqueueAttempts(attempts.map((attempt) => attempt.id));
  const view = await hydrateInspection(db, inspectionId);
  if (!view) throw new Error("Created inspection could not be loaded.");
  return (await hydrateInspection(db, inspectionId)) ?? view;
}

async function createUploadSession(db: Db, owner: { id: string }, storage: ObjectStorage | undefined, input: CreateUploadSessionPayload) {
  if (!storage) throw new Error("Image storage is required to create upload URLs.");
  if (input.targets.length < 1) throw new Error("At least one target image is required.");
  if (input.targets.length > 25) throw new Error("Sightline supports up to 25 targets per inspection.");
  assertImageMetadata(input.reference, "reference");
  input.targets.forEach((target, index) => assertImageMetadata(target, `target ${index + 1}`));

  const now = new Date();
  const inspectionId = randomUUID();
  const referenceImageId = randomUUID();
  const targetAssets = input.targets.map((target, index) => ({ ...target, id: randomUUID(), position: index }));
  const uploadInputs = [{ ...input.reference, id: referenceImageId, kind: "reference" as const }, ...targetAssets.map((target) => ({ ...target, kind: "target" as const }))];
  const signedUploads = await Promise.all(
    uploadInputs.map(async (asset) => {
      const signed = await storage.createUploadUrl({
        ownerUserId: owner.id,
        inspectionId,
        imageAssetId: asset.id,
        mimeType: asset.mimeType,
      });
      return { asset, signed };
    }),
  );

  await db.insert(inspections).values({
    id: inspectionId,
    ownerUserId: owner.id,
    status: "uploading",
    targetCount: input.targets.length,
    processedCount: 0,
    failedCount: 0,
    defectCount: 0,
    createdAt: now,
  });

  await db.insert(imageAssets).values(
    signedUploads.map(({ asset, signed }) => ({
      id: asset.id,
      ownerUserId: owner.id,
      inspectionId,
      kind: asset.kind,
      storageKey: signed.storageKey,
      originalFilename: asset.filename,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width ?? 256,
      height: asset.height ?? 180,
      uploadStatus: "pending" as const,
      createdAt: now,
    })),
  );

  const defectSpecId = randomUUID();
  await db.insert(defectSpecs).values({
    id: defectSpecId,
    ownerUserId: owner.id,
    inspectionId,
    referenceImageId,
    description: input.description.trim() || "surface crack like the reference image",
    createdAt: now,
  });
  await db.update(inspections).set({ defectSpecId }).where(eq(inspections.id, inspectionId));

  await db.insert(inspectionEvents).values({
    inspectionId,
    actorUserId: owner.id,
    kind: "inspection_created",
    payload: { mode: "upload-session", targetCount: input.targets.length },
    createdAt: now,
  });

  return {
    inspectionId,
    uploads: signedUploads.map(({ asset, signed }) => ({
      imageAssetId: asset.id,
      kind: asset.kind,
      uploadUrl: signed.url,
      method: signed.method ?? "PUT",
      headers: signed.headers ?? {},
    })),
  };
}

async function completeUploads(db: Db, owner: { id: string }, storage: ObjectStorage | undefined, jobQueue: JobQueue | undefined, input: CompleteUploadsPayload) {
  const [inspection] = await db.select().from(inspections).where(and(eq(inspections.id, input.inspectionId), eq(inspections.ownerUserId, owner.id)));
  if (!inspection) throw new Error("Inspection not found.");
  const assets = await db.select().from(imageAssets).where(and(eq(imageAssets.inspectionId, input.inspectionId), eq(imageAssets.ownerUserId, owner.id)));
  const expectedAssetIds = new Set(assets.map((asset) => asset.id));
  if (assets.length === 0 || input.imageAssetIds.length !== assets.length || input.imageAssetIds.some((id) => !expectedAssetIds.has(id))) {
    throw new Error("Uploaded assets do not match this inspection.");
  }
  for (const asset of assets) {
    if (storage?.exists && !(await storage.exists(asset.storageKey))) {
      throw new Error(`Upload missing for ${asset.originalFilename}.`);
    }
    const head = storage?.head ? await storage.head(asset.storageKey) : undefined;
    if (head?.byteSize !== undefined && head.byteSize !== asset.byteSize) {
      throw new Error(`Upload size mismatch for ${asset.originalFilename}.`);
    }
    if (head?.mimeType && normalizeMimeType(head.mimeType) !== normalizeMimeType(asset.mimeType)) {
      throw new Error(`Upload MIME type mismatch for ${asset.originalFilename}.`);
    }
  }

  const reference = assets.find((asset) => asset.kind === "reference");
  const targets = assets
    .filter((asset) => asset.kind === "target")
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  if (!reference) throw new Error("Reference upload is missing.");
  if (targets.length < 1) throw new Error("At least one target image is required.");
  if (targets.length > 25) throw new Error("Sightline supports up to 25 targets per inspection.");

  const now = new Date();
  const targetRows: ReviewTarget[] = targets.map((asset, index) => ({
    id: randomUUID(),
    inspectionId: input.inspectionId,
    targetImageId: asset.id,
    position: index,
    latestAttemptId: randomUUID(),
    createdAt: now.toISOString(),
    image: {
      originalFilename: asset.originalFilename,
      url: assetUrl(asset),
      width: asset.width ?? 256,
      height: asset.height ?? 180,
    },
  }));
  const attempts = makeInitialAttempts({ inspectionId: input.inspectionId, targets: targetRows, createdAt: now.toISOString() });

  await db.transaction(async (tx) => {
    await tx.update(imageAssets).set({ uploadStatus: "verified" }).where(eq(imageAssets.inspectionId, input.inspectionId));
    await tx.update(inspections).set({ status: "processing", submittedAt: now }).where(eq(inspections.id, input.inspectionId));

    for (const target of targetRows) {
      await tx.insert(inspectionTargets).values({
        id: target.id,
        inspectionId: target.inspectionId,
        targetImageId: target.targetImageId,
        position: target.position,
        createdAt: now,
      });
    }
    await tx.insert(processingAttempts).values(
      attempts.map((attempt) => ({
        id: attempt.id,
        inspectionId: attempt.inspectionId,
        inspectionTargetId: attempt.inspectionTargetId,
        status: attempt.status,
        attempt: attempt.attempt,
        idempotencyKey: attempt.idempotencyKey,
        startedAt: attempt.startedAt ? new Date(attempt.startedAt) : undefined,
      })),
    );
    for (const target of targetRows) {
      await tx.update(inspectionTargets).set({ latestAttemptId: target.latestAttemptId }).where(eq(inspectionTargets.id, target.id));
    }
    await tx.insert(inspectionEvents).values({
      inspectionId: input.inspectionId,
      actorUserId: owner.id,
      kind: "uploads_verified",
      payload: { assetCount: assets.length },
      createdAt: now,
    });
  });

  await jobQueue?.enqueueAttempts(attempts.map((attempt) => attempt.id));
  const view = await hydrateInspection(db, input.inspectionId);
  if (!view) throw new Error("Completed inspection could not be loaded.");
  return (await hydrateInspection(db, input.inspectionId)) ?? view;
}

async function createFeedback(db: Db, owner: { id: string }, input: FeedbackPayload) {
  const view = await hydrateInspection(db, input.inspectionId);
  if (!view || view.ownerUserId !== owner.id) throw new Error("Inspection not found.");
  const target = view.targets.find((item) => item.id === input.targetId);
  if (!target) throw new Error("Target not found.");
  const result = view.results.find((item) => item.id === target.latestResultId);
  await db.insert(feedback).values({
    inspectionId: view.id,
    inspectionTargetId: target.id,
    subjectType: result ? "result" : "target",
    subjectId: result?.id,
    verdict: input.verdict,
    createdByUserId: owner.id,
    createdAt: new Date(),
  });
  const next = await hydrateInspection(db, input.inspectionId);
  if (!next) throw new Error("Inspection not found.");
  await rebuildInspectionCounters(db, next.id);
  return (await hydrateInspection(db, input.inspectionId)) ?? next;
}

async function deleteInspection(db: Db, owner: { id: string }, input: DeletePayload) {
  const [inspection] = await db.select().from(inspections).where(eq(inspections.id, input.inspectionId));
  if (!inspection) return;
  if (inspection.ownerUserId !== owner.id) throw new Error("Inspection not found.");

  // The FK graph has two complications:
  // 1. inspections.defect_spec_id → defect_specs.id is circular (defect_specs.inspection_id
  //    also references inspections). NULL the inspection's defect_spec_id first to break it.
  // 2. defect_specs.reference_image_id → image_assets.id has no cascade, so defect_specs must
  //    be deleted before image_assets.
  // Other child tables cascade from inspection_targets via their FKs (processingAttempts,
  // inspectionResults, detections, feedback all cascade on inspection_target_id or directly
  // on inspection_id). Deleting inspection_targets handles the chain for those.
  await db.transaction(async (tx) => {
    await tx.update(inspections).set({ defectSpecId: null }).where(eq(inspections.id, input.inspectionId));
    await tx.delete(inspectionEvents).where(eq(inspectionEvents.inspectionId, input.inspectionId));
    await tx.delete(inspectionTargets).where(eq(inspectionTargets.inspectionId, input.inspectionId));
    await tx.delete(defectSpecs).where(eq(defectSpecs.inspectionId, input.inspectionId));
    await tx.delete(imageAssets).where(eq(imageAssets.inspectionId, input.inspectionId));
    await tx.delete(inspections).where(eq(inspections.id, input.inspectionId));
  });
}

async function cancelInspection(db: Db, owner: { id: string }, input: CancelPayload) {
  const view = await hydrateInspection(db, input.inspectionId);
  if (!view || view.ownerUserId !== owner.id) throw new Error("Inspection not found.");
  if (view.status === "cancelled" || view.status === "completed" || view.status === "failed" || view.status === "partially_failed") {
    return view;
  }

  const now = new Date();
  const nonTerminalIds = view.attempts
    .filter((attempt) => attempt.status === "pending" || attempt.status === "queued" || attempt.status === "running")
    .map((attempt) => attempt.id);

  if (nonTerminalIds.length > 0) {
    await db
      .update(processingAttempts)
      .set({ status: "cancelled", completedAt: now })
      .where(inArray(processingAttempts.id, nonTerminalIds));
  }

  await db.insert(inspectionEvents).values({
    id: randomUUID(),
    inspectionId: view.id,
    actorUserId: owner.id,
    kind: "inspection_cancelled",
    payload: {},
    createdAt: now,
  });

  // Rebuild counters first so processedCount / failedCount / defectCount reflect
  // the now-cancelled attempts. rebuildInspectionCounters will also (incorrectly)
  // overwrite status, so we re-stamp status="cancelled" after.
  await rebuildInspectionCounters(db, view.id);
  await db
    .update(inspections)
    .set({ status: "cancelled", cancelledAt: now, completedAt: now })
    .where(eq(inspections.id, view.id));

  return (await hydrateInspection(db, view.id)) ?? view;
}

async function retryTarget(db: Db, owner: { id: string }, jobQueue: JobQueue | undefined, input: RetryPayload) {
  const view = await hydrateInspection(db, input.inspectionId);
  if (!view || view.ownerUserId !== owner.id) throw new Error("Inspection not found.");
  const target = view.targets.find((item) => item.id === input.targetId);
  if (!target) throw new Error("Target not found.");
  const attemptCount = view.attempts.filter((attempt) => attempt.inspectionTargetId === target.id).length;
  const attempt: ProcessingAttempt = {
    id: randomUUID(),
    inspectionId: view.id,
    inspectionTargetId: target.id,
    status: "queued",
    attempt: attemptCount + 1,
    idempotencyKey: `${view.id}:${target.id}:fake:${attemptCount + 1}`,
  };
  await db.insert(processingAttempts).values({
    id: attempt.id,
    inspectionId: attempt.inspectionId,
    inspectionTargetId: attempt.inspectionTargetId,
    status: attempt.status,
    attempt: attempt.attempt,
    idempotencyKey: attempt.idempotencyKey,
  });
  await db.update(inspectionTargets).set({ latestAttemptId: attempt.id }).where(eq(inspectionTargets.id, target.id));
  await db.update(inspections).set({ status: "processing", completedAt: null }).where(eq(inspections.id, view.id));
  await jobQueue?.enqueueAttempts([attempt.id]);
  const next = await hydrateInspection(db, input.inspectionId);
  if (!next) throw new Error("Inspection not found.");
  return (await hydrateInspection(db, input.inspectionId)) ?? next;
}

async function hydrateInspection(db: Db, id: string): Promise<InspectionView | undefined> {
  const [inspection] = await db.select().from(inspections).where(eq(inspections.id, id));
  if (!inspection) return undefined;
  const [spec] = await db.select().from(defectSpecs).where(eq(defectSpecs.inspectionId, id));
  const assets = await db.select().from(imageAssets).where(eq(imageAssets.inspectionId, id));
  const targetRows = await db.select().from(inspectionTargets).where(eq(inspectionTargets.inspectionId, id)).orderBy(asc(inspectionTargets.position));
  const attemptRows = await db.select().from(processingAttempts).where(eq(processingAttempts.inspectionId, id)).orderBy(asc(processingAttempts.attempt));
  const resultRows = await db.select().from(inspectionResults).where(eq(inspectionResults.inspectionId, id));
  const detectionRows = await db.select().from(detections).where(eq(detections.inspectionId, id));
  const feedbackRows = await db.select().from(feedback).where(eq(feedback.inspectionId, id));
  const eventRows = await db.select().from(inspectionEvents).where(eq(inspectionEvents.inspectionId, id)).orderBy(asc(inspectionEvents.createdAt));
  const reference = assets.find((asset) => asset.kind === "reference");
  if (!reference || !spec) return undefined;

  const view: InspectionView = {
    id: inspection.id,
    ownerUserId: inspection.ownerUserId,
    defectSpecId: spec.id,
    status: inspection.status,
    targetCount: inspection.targetCount,
    processedCount: inspection.processedCount,
    failedCount: inspection.failedCount,
    defectCount: inspection.defectCount,
    createdAt: inspection.createdAt.toISOString(),
    submittedAt: inspection.submittedAt?.toISOString(),
    completedAt: inspection.completedAt?.toISOString(),
    cancelledAt: inspection.cancelledAt?.toISOString(),
    description: spec.description,
    referenceImage: {
      originalFilename: reference.originalFilename,
      url: assetUrl(reference),
      width: reference.width ?? 256,
      height: reference.height ?? 180,
    },
    targets: targetRows.map((target): ReviewTarget => {
      const asset = assets.find((item) => item.id === target.targetImageId);
      return {
        id: target.id,
        inspectionId: target.inspectionId,
        targetImageId: target.targetImageId,
        position: target.position,
        latestAttemptId: target.latestAttemptId ?? undefined,
        latestResultId: target.latestResultId ?? undefined,
        createdAt: target.createdAt.toISOString(),
        image: {
          originalFilename: asset?.originalFilename ?? "target.jpg",
          url: asset ? assetUrl(asset) : "/sample-target-1.svg",
          width: asset?.width ?? 256,
          height: asset?.height ?? 180,
        },
      };
    }),
    attempts: attemptRows.map(
      (attempt): ProcessingAttempt => ({
        id: attempt.id,
        inspectionId: attempt.inspectionId,
        inspectionTargetId: attempt.inspectionTargetId,
        status: attempt.status,
        attempt: attempt.attempt,
        idempotencyKey: attempt.idempotencyKey,
        analyzerRequestId: attempt.analyzerRequestId ?? undefined,
        lastError: attempt.lastError ?? undefined,
        startedAt: attempt.startedAt?.toISOString(),
        completedAt: attempt.completedAt?.toISOString(),
      }),
    ),
    results: resultRows.map(
      (result): InspectionResult => ({
        id: result.id,
        inspectionId: result.inspectionId,
        inspectionTargetId: result.inspectionTargetId,
        attemptId: result.attemptId,
        defectFound: result.defectFound,
        rawAnalyzerResponse: result.rawAnalyzerResponse,
        analyzerProvider: result.analyzerProvider,
        analyzerVersion: result.analyzerVersion ?? undefined,
        resultSchemaVersion: result.resultSchemaVersion,
        createdAt: result.createdAt.toISOString(),
      }),
    ),
    detections: detectionRows.map(
      (box): Detection => ({
        id: box.id,
        inspectionId: box.inspectionId,
        inspectionTargetId: box.inspectionTargetId,
        resultId: box.resultId,
        label: box.label,
        confidence: box.confidence ?? undefined,
        x1: box.x1,
        y1: box.y1,
        x2: box.x2,
        y2: box.y2,
        coordinateSystem: box.coordinateSystem,
        reason: box.reason ?? undefined,
        createdAt: box.createdAt.toISOString(),
      }),
    ),
    feedback: feedbackRows.map(
      (item): Feedback => ({
        id: item.id,
        inspectionId: item.inspectionId,
        inspectionTargetId: item.inspectionTargetId,
        subjectType: item.subjectType,
        subjectId: item.subjectId ?? undefined,
        verdict: item.verdict,
        reason: item.reason ?? undefined,
        note: item.note ?? undefined,
        createdByUserId: item.createdByUserId,
        createdAt: item.createdAt.toISOString(),
      }),
    ),
    events: eventRows.map(
      (item): JobEvent => ({
        id: item.id,
        inspectionId: item.inspectionId,
        actorUserId: item.actorUserId ?? undefined,
        kind: item.kind,
        payload: item.payload,
        createdAt: item.createdAt.toISOString(),
      }),
    ),
  };

  return { ...view, ...counterPatch(view) };
}

async function ensureUser(db: Db, owner: RequestOwner) {
  if (owner.id === devOwnerUserId) {
    await db
      .insert(users)
      .values({
        id: owner.id,
        clerkUserId: owner.clerkUserId,
        email: owner.email,
      })
      .onConflictDoNothing({ target: users.clerkUserId });
  } else {
    await db
      .insert(users)
      .values({
        clerkUserId: owner.clerkUserId,
        email: owner.email,
      })
      .onConflictDoNothing({ target: users.clerkUserId });
  }
  const [user] = await db.select().from(users).where(eq(users.clerkUserId, owner.clerkUserId));
  if (!user) throw new Error("Could not load current user.");
  return user;
}

function assetUrl(asset: { id: string; storageKey: string }) {
  return asset.storageKey.startsWith("/") ? asset.storageKey : `/api/images/${asset.id}`;
}

function assertImageMetadata(input: { filename: string; mimeType: string; byteSize: number }, label: string) {
  if (!input.filename.trim()) throw new Error(`Missing filename for ${label}.`);
  if (!input.mimeType.startsWith("image/")) throw new Error(`${label} must be an image.`);
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) throw new Error(`${label} is empty.`);
}

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

function shouldListInspection(view: InspectionView) {
  if (view.status === "uploading") return false;
  if ((view.status === "processing" || view.status === "queued") && view.targets.length === 0) return false;
  return true;
}
