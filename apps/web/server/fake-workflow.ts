import { randomUUID } from "node:crypto";
import type { Detection, InspectionResult, ProcessingAttempt } from "@sightline/core";
import { buildReview, summarizeInspection } from "./review";
import type { InspectionView, ReviewTarget } from "./types";

export const devOwnerUserId = "00000000-0000-4000-8000-000000000001";
export const sampleTargetUrls = [1, 2, 3, 4, 5].map((index) => `/sample-target-${index}.svg`);

export function normalizeTargets(filenames: string[] | undefined) {
  const names = filenames?.filter(Boolean).slice(0, 25);
  if (names?.length) return names;
  return Array.from({ length: 5 }, (_, index) => `target-crack-0${index + 1}.jpg`);
}

export function makeTargets(input: { inspectionId: string; createdAt: string; filenames?: string[] }) {
  return normalizeTargets(input.filenames).map((filename, index): ReviewTarget => {
    const targetId = randomUUID();
    const attemptId = randomUUID();
    return {
      id: targetId,
      inspectionId: input.inspectionId,
      targetImageId: randomUUID(),
      position: index,
      latestAttemptId: attemptId,
      latestResultId: undefined,
      createdAt: input.createdAt,
      image: {
        originalFilename: filename,
        url: sampleTargetUrls[index % sampleTargetUrls.length],
        width: 256,
        height: 180,
      },
    };
  });
}

export function makeInitialAttempts(input: { inspectionId: string; targets: ReviewTarget[]; createdAt: string }) {
  return input.targets.map((target): ProcessingAttempt => ({
    id: target.latestAttemptId!,
    inspectionId: input.inspectionId,
    inspectionTargetId: target.id,
    status: "queued",
    attempt: 1,
    idempotencyKey: `${input.inspectionId}:${target.id}:fake:1`,
  }));
}

export function advanceInspection(inspection: InspectionView) {
  const running = inspection.attempts.find((attempt) => attempt.status === "running");
  if (running) completeAttempt(inspection, running);

  const queued = inspection.attempts.find((attempt) => attempt.status === "queued");
  if (queued && inspection.status === "processing") {
    queued.status = "running";
    queued.startedAt = new Date().toISOString();
  }

  Object.assign(inspection, counterPatch(inspection));
}

export function completeAttempt(inspection: InspectionView, attempt: ProcessingAttempt) {
  const target = inspection.targets.find((item) => item.id === attempt.inspectionTargetId);
  if (!target) throw new Error("Target not found for attempt.");
  const now = new Date().toISOString();
  const shouldFail = target.position === 3 && attempt.attempt === 1;
  attempt.completedAt = now;

  if (shouldFail) {
    attempt.status = "failed";
    attempt.lastError = "Fake analyzer timeout";
    return;
  }

  const resultId = randomUUID();
  const defectFound = target.position === 0 || target.position === 2 || attempt.attempt > 1;
  const result: InspectionResult = {
    id: resultId,
    inspectionId: inspection.id,
    inspectionTargetId: target.id,
    attemptId: attempt.id,
    defectFound,
    rawAnalyzerResponse: {
      provider: "fake",
      target: target.image.originalFilename,
    },
    analyzerProvider: "fake",
    analyzerVersion: "dev-v1",
    resultSchemaVersion: 1,
    createdAt: now,
  };
  inspection.results.push(result);
  target.latestResultId = result.id;
  attempt.status = "succeeded";

  if (defectFound) {
    inspection.detections.push(fakeDetection(inspection.id, target.id, resultId, target.position, now));
  }
}

export function counterPatch(inspection: InspectionView) {
  const review = buildReview(inspection);
  const summary = summarizeInspection(inspection);
  const allTerminal = summary.total > 0 && review.targets.every((target) => ["defect", "clean", "failed"].includes(target.bucket));
  let status = inspection.status;
  if (allTerminal && summary.failed === 0) status = "completed";
  if (allTerminal && summary.failed === summary.total) status = "failed";
  if (allTerminal && summary.failed > 0 && summary.failed < summary.total) status = "partially_failed";
  if (!allTerminal && inspection.status !== "cancelled") status = "processing";
  return {
    status,
    targetCount: summary.total,
    processedCount: summary.processed,
    failedCount: summary.failed,
    defectCount: summary.defect,
    completedAt: allTerminal ? inspection.completedAt ?? new Date().toISOString() : undefined,
  };
}

export function fakeDetection(inspectionId: string, targetId: string, resultId: string, position: number, createdAt: string): Detection {
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
    coordinateSystem: "pixel",
    reason,
    createdAt,
  };
}
