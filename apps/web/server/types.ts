import type { Detection, Feedback, Inspection, InspectionResult, InspectionTarget, JobEvent, ProcessingAttempt } from "@sightline/core";

export type ReviewTarget = InspectionTarget & {
  image: {
    originalFilename: string;
    url: string;
    width: number;
    height: number;
  };
};

export type InspectionView = Inspection & {
  description: string;
  referenceImage: {
    originalFilename: string;
    url: string;
    width: number;
    height: number;
  };
  targets: ReviewTarget[];
  attempts: ProcessingAttempt[];
  results: InspectionResult[];
  detections: Detection[];
  feedback: Feedback[];
  events: JobEvent[];
};

export type ReviewBucket = "queued" | "running" | "defect" | "clean" | "failed";

export type ReviewTargetView = ReviewTarget & {
  bucket: ReviewBucket;
  latestAttempt?: ProcessingAttempt;
  latestResult?: InspectionResult;
  detections: Detection[];
  summary: string;
};
