import type { Feedback, InspectionResult, InspectionTarget, ProcessingAttempt } from "./domain.ts";

export type ReviewBucket = "queued" | "running" | "defect" | "clean" | "failed";

export function deriveInspectionStatus(attempts: ProcessingAttempt[]) {
  if (attempts.length === 0) return "draft";

  const latest = attempts;
  const allTerminal = latest.every((attempt) => isTerminal(attempt.status));
  const anyActive = latest.some((attempt) => attempt.status === "queued" || attempt.status === "running" || attempt.status === "pending");
  const succeeded = latest.filter((attempt) => attempt.status === "succeeded").length;
  const failed = latest.filter((attempt) => attempt.status === "failed").length;

  if (allTerminal && succeeded === latest.length) return "completed";
  if (allTerminal && failed === latest.length) return "failed";
  if (allTerminal && succeeded > 0 && failed > 0) return "partially_failed";
  if (anyActive) return "processing";
  return "queued";
}

export function deriveReviewBucket(input: {
  target: InspectionTarget;
  latestAttempt?: ProcessingAttempt;
  latestResult?: InspectionResult;
  feedback: Feedback[];
}): ReviewBucket {
  if (!input.latestAttempt || input.latestAttempt.status === "pending" || input.latestAttempt.status === "queued") return "queued";
  if (input.latestAttempt.status === "running") return "running";
  if (input.latestAttempt.status === "failed") return "failed";

  const result = input.latestResult;
  if (!result) return "queued";
  if (!result.defectFound) return "clean";

  const wrongFeedback = input.feedback.some((feedback) => {
    if (feedback.verdict !== "wrong") return false;
    if (feedback.inspectionTargetId !== input.target.id) return false;
    return feedback.subjectType === "target" || feedback.subjectId === result.id;
  });

  return wrongFeedback ? "clean" : "defect";
}

export function isTerminal(status: ProcessingAttempt["status"]) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
