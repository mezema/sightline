import type { AnalyzerResult } from "../analyzers/DefectAnalyzer.ts";

export type JobStatus = "draft" | "processing" | "completed" | "partially_failed" | "failed";

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
  const detectedImages = job.results.filter((result) => result.defectFound).length;
  const detections = job.results.reduce((sum, result) => sum + result.detections.length, 0);

  return {
    total: job.targetImages.length,
    processed: job.results.length,
    failures,
    detectedImages,
    detections,
  };
}
