export type ISODateString = string;

export type InspectionStatus =
  | "draft"
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "partially_failed"
  | "failed"
  | "cancelled";

export type AttemptStatus = "pending" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ImageAssetKind = "reference" | "target" | "annotated_result";
export type UploadStatus = "pending" | "uploaded" | "verified" | "failed";
export type CoordinateSystem = "pixel";
export type FeedbackSubjectType = "target" | "result" | "detection";
export type FeedbackVerdict = "correct" | "wrong";
export type FeedbackReason = "false_positive" | "false_negative" | "wrong_location" | "wrong_label" | "other";

export type User = {
  id: string;
  email: string;
  createdAt: ISODateString;
};

export type Inspection = {
  id: string;
  ownerUserId: string;
  defectSpecId: string;
  status: InspectionStatus;
  targetCount: number;
  processedCount: number;
  failedCount: number;
  defectCount: number;
  createdAt: ISODateString;
  submittedAt?: ISODateString;
  completedAt?: ISODateString;
  cancelledAt?: ISODateString;
};

export type DefectSpec = {
  id: string;
  ownerUserId: string;
  inspectionId: string;
  referenceImageId: string;
  description: string;
  createdAt: ISODateString;
};

export type ImageAsset = {
  id: string;
  ownerUserId: string;
  inspectionId: string;
  kind: ImageAssetKind;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  contentHash?: string;
  uploadStatus: UploadStatus;
  createdAt: ISODateString;
};

export type InspectionTarget = {
  id: string;
  inspectionId: string;
  targetImageId: string;
  position: number;
  latestAttemptId?: string;
  latestResultId?: string;
  createdAt: ISODateString;
};

export type ProcessingAttempt = {
  id: string;
  inspectionId: string;
  inspectionTargetId: string;
  status: AttemptStatus;
  attempt: number;
  idempotencyKey: string;
  analyzerRequestId?: string;
  lastError?: string;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
};

export type InspectionResult = {
  id: string;
  inspectionId: string;
  inspectionTargetId: string;
  attemptId: string;
  defectFound: boolean;
  rawAnalyzerResponse: unknown;
  analyzerProvider: string;
  analyzerVersion?: string;
  resultSchemaVersion: number;
  createdAt: ISODateString;
};

export type Detection = {
  id: string;
  inspectionId: string;
  inspectionTargetId: string;
  resultId: string;
  label: string;
  confidence?: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  coordinateSystem: CoordinateSystem;
  reason?: string;
  createdAt: ISODateString;
};

export type Feedback = {
  id: string;
  inspectionId: string;
  inspectionTargetId: string;
  subjectType: FeedbackSubjectType;
  subjectId?: string;
  verdict: FeedbackVerdict;
  reason?: FeedbackReason;
  note?: string;
  createdByUserId: string;
  createdAt: ISODateString;
};

export type JobEventKind =
  | "inspection_created"
  | "uploads_verified"
  | "inspection_submitted"
  | "attempt_started"
  | "attempt_succeeded"
  | "attempt_failed"
  | "feedback_created"
  | "target_retried"
  | "inspection_cancelled";

export type JobEvent = {
  id: string;
  inspectionId: string;
  actorUserId?: string;
  kind: JobEventKind;
  payload: unknown;
  createdAt: ISODateString;
};

export type OutboxEvent = {
  id: string;
  kind: string;
  payload: unknown;
  status: "pending" | "published" | "failed";
  createdAt: ISODateString;
  publishedAt?: ISODateString;
};
