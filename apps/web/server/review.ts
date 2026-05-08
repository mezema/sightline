import { deriveReviewBucket } from "@sightline/core";
import type { InspectionView, ReviewTargetView } from "./types";

export function buildReview(view: InspectionView) {
  return {
    ...view,
    targets: view.targets.map((target): ReviewTargetView => {
      const latestAttempt = view.attempts.find((attemptItem) => attemptItem.id === target.latestAttemptId);
      const latestResult = view.results.find((resultItem) => resultItem.id === target.latestResultId);
      const detections = latestResult ? view.detections.filter((box) => box.resultId === latestResult.id) : [];
      const bucket = deriveReviewBucket({ target, latestAttempt, latestResult, feedback: view.feedback });
      return {
        ...target,
        bucket,
        latestAttempt,
        latestResult,
        detections,
        summary: summarizeTarget(bucket, latestAttempt, detections.length),
      };
    }),
  };
}

export function summarizeTarget(bucket: string, attemptItem: { lastError?: string } | undefined, detectionCount: number) {
  if (bucket === "failed") return attemptItem?.lastError ?? "Failed";
  if (bucket === "queued") return "Waiting for processing";
  if (bucket === "running") return "Processing now";
  if (bucket === "defect") return `${detectionCount} detection${detectionCount === 1 ? "" : "s"}`;
  return "No matching defect";
}

export function summarizeInspection(view: InspectionView) {
  const review = buildReview(view);
  return {
    total: review.targets.length,
    processed: review.targets.filter((target) => ["defect", "clean", "failed"].includes(target.bucket)).length,
    defect: review.targets.filter((target) => target.bucket === "defect").length,
    clean: review.targets.filter((target) => target.bucket === "clean").length,
    failed: review.targets.filter((target) => target.bucket === "failed").length,
  };
}
