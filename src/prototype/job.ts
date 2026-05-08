import type { AnalyzerResult } from "../analyzers/DefectAnalyzer.ts";

export type JobStatus = "draft" | "processing" | "completed" | "partially_failed" | "failed";

export type Feedback = {
  id: string;
  targetImageId: string;
  resultTargetImage: string;
  kind: "confirm" | "reject";
  createdAt: string;
};

export type JobImage = {
  id: string;
  originalFilename: string;
  path: string;
  url: string;
  mimeType: string;
  byteSize: number;
};

export type InspectionJob = {
  id: string;
  status: JobStatus;
  description: string;
  referenceImage: JobImage;
  targetImages: JobImage[];
  results: AnalyzerResult[];
  feedback?: Feedback[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

export function deriveJobStatus(targetCount: number, results: AnalyzerResult[]): JobStatus {
  if (results.length === 0) return "processing";
  if (results.length < targetCount) return "processing";

  const failures = results.filter((result) => result.error).length;
  if (failures === 0) return "completed";
  if (failures === targetCount) return "failed";
  return "partially_failed";
}

export function summarizeJob(job: InspectionJob) {
  const failures = job.results.filter((result) => result.error).length;
  const detectedImages = job.targetImages.filter((target) => isTargetDefect(job, target)).length;
  const detections = job.results.reduce((sum, result) => sum + result.detections.length, 0);

  return {
    total: job.targetImages.length,
    processed: job.results.length,
    failures,
    detectedImages,
    detections,
  };
}

export function latestResultForTarget(job: InspectionJob, target: JobImage) {
  return [...job.results].reverse().find((result) => result.targetImage === target.path.split("/").at(-1));
}

export function latestFeedbackForTarget(job: InspectionJob, target: JobImage) {
  return [...(job.feedback ?? [])].reverse().find((feedback) => feedback.targetImageId === target.id);
}

export function isTargetDefect(job: InspectionJob, target: JobImage): boolean {
  const result = latestResultForTarget(job, target);
  const feedback = latestFeedbackForTarget(job, target);
  if (!result || result.error) return false;
  if (feedback?.kind === "reject") return false;
  return result.defectFound;
}
