import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ImageAsset, Inspection, InspectionTarget, ProcessingStore, SaveAnalyzerResultInput } from "@sightline/core";
import { createDbConnection } from "./index.ts";
import { rebuildInspectionCounters } from "./fake-processing.ts";
import { defectSpecs, detections, imageAssets, inspectionEvents, inspectionResults, inspections, inspectionTargets, processingAttempts } from "./schema/index.ts";

type Db = ReturnType<typeof createDbConnection>["db"];

export function createDrizzleProcessingStore(databaseUrl = process.env.DATABASE_URL): ProcessingStore & { close(): Promise<void> } {
  const connection = createDbConnection(databaseUrl);
  const db = connection.db;
  return {
    loadAttemptContext: (attemptId) => loadAttemptContext(db, attemptId),
    markAttemptRunning: (attemptId) => markAttemptRunning(db, attemptId),
    saveAnalyzerResult: (input) => saveAnalyzerResult(db, input),
    saveAnalyzerFailure: (input) => saveAnalyzerFailure(db, input),
    close: connection.close,
  };
}

async function loadAttemptContext(db: Db, attemptId: string) {
  const [attemptRow] = await db.select().from(processingAttempts).where(eq(processingAttempts.id, attemptId));
  if (!attemptRow) throw new Error("Processing attempt not found.");

  const [inspectionRow] = await db.select().from(inspections).where(eq(inspections.id, attemptRow.inspectionId));
  if (!inspectionRow) throw new Error("Inspection not found for processing attempt.");

  const [targetRow] = await db.select().from(inspectionTargets).where(eq(inspectionTargets.id, attemptRow.inspectionTargetId));
  if (!targetRow) throw new Error("Inspection target not found for processing attempt.");

  const [targetImageRow] = await db.select().from(imageAssets).where(eq(imageAssets.id, targetRow.targetImageId));
  if (!targetImageRow) throw new Error("Target image not found for processing attempt.");

  const [specRow] = await db.select().from(defectSpecs).where(eq(defectSpecs.inspectionId, attemptRow.inspectionId));
  if (!specRow) throw new Error("Defect spec not found for processing attempt.");

  const [referenceImageRow] = await db.select().from(imageAssets).where(eq(imageAssets.id, specRow.referenceImageId));
  if (!referenceImageRow) throw new Error("Reference image not found for processing attempt.");

  return {
    attempt: {
      id: attemptRow.id,
      inspectionId: attemptRow.inspectionId,
      inspectionTargetId: attemptRow.inspectionTargetId,
      status: attemptRow.status,
      attempt: attemptRow.attempt,
      idempotencyKey: attemptRow.idempotencyKey,
      analyzerRequestId: attemptRow.analyzerRequestId ?? undefined,
      lastError: attemptRow.lastError ?? undefined,
      startedAt: attemptRow.startedAt?.toISOString(),
      completedAt: attemptRow.completedAt?.toISOString(),
    },
    inspection: {
      id: inspectionRow.id,
      ownerUserId: inspectionRow.ownerUserId,
      defectSpecId: specRow.id,
      status: inspectionRow.status,
      targetCount: inspectionRow.targetCount,
      processedCount: inspectionRow.processedCount,
      failedCount: inspectionRow.failedCount,
      defectCount: inspectionRow.defectCount,
      createdAt: inspectionRow.createdAt.toISOString(),
      submittedAt: inspectionRow.submittedAt?.toISOString(),
      completedAt: inspectionRow.completedAt?.toISOString(),
      cancelledAt: inspectionRow.cancelledAt?.toISOString(),
    } satisfies Inspection,
    referenceImage: imageAsset(referenceImageRow),
    target: {
      id: targetRow.id,
      inspectionId: targetRow.inspectionId,
      targetImageId: targetRow.targetImageId,
      position: targetRow.position,
      latestAttemptId: targetRow.latestAttemptId ?? undefined,
      latestResultId: targetRow.latestResultId ?? undefined,
      createdAt: targetRow.createdAt.toISOString(),
    } satisfies InspectionTarget,
    targetImage: imageAsset(targetImageRow),
    defectDescription: specRow.description,
  };
}

async function markAttemptRunning(db: Db, attemptId: string) {
  const [attempt] = await db.select().from(processingAttempts).where(eq(processingAttempts.id, attemptId));
  if (!attempt || attempt.status === "succeeded" || attempt.status === "failed" || attempt.status === "cancelled") return false;
  if (attempt.status !== "running") {
    await db.update(processingAttempts).set({ status: "running", startedAt: attempt.startedAt ?? new Date() }).where(eq(processingAttempts.id, attemptId));
    await db.insert(inspectionEvents).values({
      inspectionId: attempt.inspectionId,
      kind: "attempt_started",
      payload: { attemptId },
      createdAt: new Date(),
    });
  }
  return true;
}

async function saveAnalyzerResult(db: Db, input: SaveAnalyzerResultInput) {
  const now = new Date();
  const resultId = randomUUID();
  const [attempt] = await db.select().from(processingAttempts).where(eq(processingAttempts.id, input.result.attemptId));
  if (!attempt) throw new Error("Processing attempt not found.");
  if (attempt.status !== "running") return;

  await db
    .insert(inspectionResults)
    .values({
      id: resultId,
      inspectionId: input.result.inspectionId,
      inspectionTargetId: input.result.inspectionTargetId,
      attemptId: input.result.attemptId,
      defectFound: input.result.defectFound,
      rawAnalyzerResponse: input.result.rawAnalyzerResponse,
      analyzerProvider: input.result.analyzerProvider,
      analyzerVersion: input.result.analyzerVersion,
      resultSchemaVersion: input.result.resultSchemaVersion,
      createdAt: now,
    })
    .onConflictDoNothing({ target: inspectionResults.attemptId });

  const [result] = await db.select().from(inspectionResults).where(eq(inspectionResults.attemptId, input.result.attemptId));
  if (!result) throw new Error("Analyzer result could not be saved.");

  if (result.id === resultId && input.detections.length > 0) {
    await db.insert(detections).values(
      input.detections.map((box) => ({
        id: randomUUID(),
        inspectionId: box.inspectionId,
        inspectionTargetId: box.inspectionTargetId,
        resultId: result.id,
        label: box.label,
        confidence: box.confidence,
        x1: box.x1,
        y1: box.y1,
        x2: box.x2,
        y2: box.y2,
        coordinateSystem: box.coordinateSystem,
        reason: box.reason,
        createdAt: now,
      })),
    );
  }

  await db.update(processingAttempts).set({ status: "succeeded", completedAt: now }).where(eq(processingAttempts.id, input.result.attemptId));
  const [target] = await db.select().from(inspectionTargets).where(eq(inspectionTargets.id, input.result.inspectionTargetId));
  if (target?.latestAttemptId === input.result.attemptId) {
    await db.update(inspectionTargets).set({ latestResultId: result.id }).where(eq(inspectionTargets.id, input.result.inspectionTargetId));
  }
  await db.insert(inspectionEvents).values({
    inspectionId: input.result.inspectionId,
    kind: "attempt_succeeded",
    payload: { attemptId: input.result.attemptId, resultId: result.id, analyzerProvider: input.result.analyzerProvider },
    createdAt: now,
  });
  await rebuildInspectionCounters(db, input.result.inspectionId);
}

async function saveAnalyzerFailure(db: Db, input: { attemptId: string; error: string }) {
  const now = new Date();
  const [attempt] = await db.select().from(processingAttempts).where(eq(processingAttempts.id, input.attemptId));
  if (!attempt) throw new Error("Processing attempt not found.");
  if (attempt.status !== "running") return;

  await db.update(processingAttempts).set({ status: "failed", lastError: input.error, completedAt: now }).where(eq(processingAttempts.id, input.attemptId));
  await db.insert(inspectionEvents).values({
    inspectionId: attempt.inspectionId,
    kind: "attempt_failed",
    payload: { attemptId: input.attemptId, error: input.error },
    createdAt: now,
  });
  await rebuildInspectionCounters(db, attempt.inspectionId);
}

function imageAsset(row: typeof imageAssets.$inferSelect): ImageAsset {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    inspectionId: row.inspectionId,
    kind: row.kind,
    storageKey: row.storageKey,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    contentHash: row.contentHash ?? undefined,
    uploadStatus: row.uploadStatus,
    createdAt: row.createdAt.toISOString(),
  };
}
