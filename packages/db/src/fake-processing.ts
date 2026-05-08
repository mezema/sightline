import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { deriveInspectionStatus, deriveReviewBucket, type Feedback, type InspectionResult, type InspectionTarget, type ProcessingAttempt } from "@sightline/core";
import { createDb } from "./index.ts";
import { detections, feedback, imageAssets, inspectionEvents, inspectionResults, inspections, inspectionTargets, processingAttempts } from "./schema/index.ts";

type Db = ReturnType<typeof createDb>;

const cachedDbs = new Map<string, Db>();

export async function processFakeAttempt(databaseUrl: string, attemptId: string) {
  const db = getDb(databaseUrl);
  await markAttemptRunning(db, attemptId);

  const [attempt] = await db.select().from(processingAttempts).where(eq(processingAttempts.id, attemptId));
  if (!attempt || attempt.status === "succeeded" || attempt.status === "failed" || attempt.status === "cancelled") return;

  const [target] = await db.select().from(inspectionTargets).where(eq(inspectionTargets.id, attempt.inspectionTargetId));
  if (!target) throw new Error("Target not found for processing attempt.");

  const now = new Date();
  const shouldFail = target.position === 3 && attempt.attempt === 1;
  if (shouldFail) {
    await db
      .update(processingAttempts)
      .set({ status: "failed", lastError: "Fake analyzer timeout", completedAt: now })
      .where(eq(processingAttempts.id, attempt.id));
    await db.insert(inspectionEvents).values({
      inspectionId: attempt.inspectionId,
      kind: "attempt_failed",
      payload: { attemptId: attempt.id, error: "Fake analyzer timeout" },
      createdAt: now,
    });
    await rebuildInspectionCounters(db, attempt.inspectionId);
    return;
  }

  const existing = await db.select().from(inspectionResults).where(eq(inspectionResults.attemptId, attempt.id));
  const resultId = existing[0]?.id ?? randomUUID();
  const defectFound = target.position === 0 || target.position === 2 || attempt.attempt > 1;

  if (!existing[0]) {
    const targetAsset = await db.select().from(imageAssets).where(eq(imageAssets.id, target.targetImageId));
    await db.insert(inspectionResults).values({
      id: resultId,
      inspectionId: attempt.inspectionId,
      inspectionTargetId: target.id,
      attemptId: attempt.id,
      defectFound,
      rawAnalyzerResponse: { provider: "fake", target: targetAsset[0]?.originalFilename ?? target.targetImageId },
      analyzerProvider: "fake",
      analyzerVersion: "dev-v1",
      resultSchemaVersion: 1,
      createdAt: now,
    });
    if (defectFound) {
      const box = fakeDetection(attempt.inspectionId, target.id, resultId, target.position, now);
      await db.insert(detections).values(box);
    }
  }

  await db.update(processingAttempts).set({ status: "succeeded", completedAt: now }).where(eq(processingAttempts.id, attempt.id));
  if (target.latestAttemptId === attempt.id) {
    await db.update(inspectionTargets).set({ latestResultId: resultId }).where(eq(inspectionTargets.id, target.id));
  }
  await db.insert(inspectionEvents).values({
    inspectionId: attempt.inspectionId,
    kind: "attempt_succeeded",
    payload: { attemptId: attempt.id, resultId },
    createdAt: now,
  });
  await rebuildInspectionCounters(db, attempt.inspectionId);
}

function getDb(databaseUrl: string) {
  const existing = cachedDbs.get(databaseUrl);
  if (existing) return existing;
  const db = createDb(databaseUrl);
  cachedDbs.set(databaseUrl, db);
  return db;
}

async function markAttemptRunning(db: Db, attemptId: string) {
  const [attempt] = await db.select().from(processingAttempts).where(eq(processingAttempts.id, attemptId));
  if (!attempt || attempt.status === "succeeded" || attempt.status === "failed" || attempt.status === "cancelled") return;
  if (attempt.status !== "running") {
    await db.update(processingAttempts).set({ status: "running", startedAt: new Date() }).where(eq(processingAttempts.id, attemptId));
    await db.insert(inspectionEvents).values({
      inspectionId: attempt.inspectionId,
      kind: "attempt_started",
      payload: { attemptId },
      createdAt: new Date(),
    });
  }
}

export async function rebuildInspectionCounters(db: Db, inspectionId: string) {
  const targetRows = await db.select().from(inspectionTargets).where(eq(inspectionTargets.inspectionId, inspectionId)).orderBy(asc(inspectionTargets.position));
  const attemptRows = await db.select().from(processingAttempts).where(eq(processingAttempts.inspectionId, inspectionId));
  const resultRows = await db.select().from(inspectionResults).where(eq(inspectionResults.inspectionId, inspectionId));
  const feedbackRows = await db.select().from(feedback).where(eq(feedback.inspectionId, inspectionId));

  const targets = targetRows.map(
    (target): InspectionTarget => ({
      id: target.id,
      inspectionId: target.inspectionId,
      targetImageId: target.targetImageId,
      position: target.position,
      latestAttemptId: target.latestAttemptId ?? undefined,
      latestResultId: target.latestResultId ?? undefined,
      createdAt: target.createdAt.toISOString(),
    }),
  );
  const attempts = attemptRows.map(
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
  );
  const results = resultRows.map(
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
  );
  const feedbackItems = feedbackRows.map(
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
  );

  const latestAttempts = targets.map((target) => attempts.find((attempt) => attempt.id === target.latestAttemptId)).filter((attempt): attempt is ProcessingAttempt => Boolean(attempt));
  const processedCount = latestAttempts.filter((attempt) => attempt.status === "succeeded" || attempt.status === "failed" || attempt.status === "cancelled").length;
  const failedCount = latestAttempts.filter((attempt) => attempt.status === "failed").length;
  const defectCount = targets.filter((target) => {
    const latestAttempt = attempts.find((attempt) => attempt.id === target.latestAttemptId);
    const latestResult = results.find((result) => result.id === target.latestResultId);
    return deriveReviewBucket({ target, latestAttempt, latestResult, feedback: feedbackItems }) === "defect";
  }).length;
  const status = targets.length ? deriveInspectionStatus(latestAttempts) : "uploading";
  const completedAt = targets.length > 0 && processedCount === targets.length ? new Date() : null;

  await db
    .update(inspections)
    .set({
      status,
      targetCount: targets.length,
      processedCount,
      failedCount,
      defectCount,
      completedAt,
    })
    .where(eq(inspections.id, inspectionId));
}

function fakeDetection(inspectionId: string, targetId: string, resultId: string, position: number, createdAt: Date) {
  const presets = [
    [42, 48, 126, 92, "thin surface crack near the upper-left edge"],
    [74, 42, 138, 96, "deterministic fake detection"],
    [118, 78, 196, 122, "branching mark matches the defect spec"],
    [96, 64, 164, 118, "retry found a defect-like region"],
    [54, 36, 112, 102, "edge chip aligned with the reference"],
  ] as const;
  const [x1, y1, x2, y2, reason] = presets[position % presets.length];
  return {
    id: randomUUID(),
    inspectionId,
    inspectionTargetId: targetId,
    resultId,
    label: "defect",
    confidence: 0.72,
    x1,
    y1,
    x2,
    y2,
    coordinateSystem: "pixel" as const,
    reason,
    createdAt,
  };
}
