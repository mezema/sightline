import type { InspectionView } from "./types";

export type CreateInspectionPayload = {
  description: string;
  referenceFilename?: string;
  targetFilenames?: string[];
};

export type UploadFileMetadata = {
  filename: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
};

export type UploadDescriptor = {
  imageAssetId: string;
  kind: "reference" | "target";
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
};

export type CreateUploadSessionPayload = {
  description: string;
  reference: UploadFileMetadata;
  targets: UploadFileMetadata[];
};

export type UploadSession = {
  inspectionId: string;
  uploads: UploadDescriptor[];
};

export type CompleteUploadsPayload = {
  inspectionId: string;
  imageAssetIds: string[];
};

export type FeedbackPayload = {
  inspectionId: string;
  targetId: string;
  verdict: "correct" | "wrong";
};

export type RetryPayload = {
  inspectionId: string;
  targetId: string;
};

export type CancelPayload = {
  inspectionId: string;
};

export type DeletePayload = {
  inspectionId: string;
};

export interface InspectionWorkflowRepository {
  listInspections(): Promise<InspectionView[]>;
  getInspection(id: string): Promise<InspectionView | undefined>;
  createInspection(input: CreateInspectionPayload): Promise<InspectionView>;
  createUploadSession(input: CreateUploadSessionPayload): Promise<UploadSession>;
  completeUploads(input: CompleteUploadsPayload): Promise<InspectionView>;
  createFeedback(input: FeedbackPayload): Promise<InspectionView>;
  retryTarget(input: RetryPayload): Promise<InspectionView>;
  cancelInspection(input: CancelPayload): Promise<InspectionView>;
  deleteInspection(input: DeletePayload): Promise<void>;
}

export interface JobQueue {
  enqueueAttempts(attemptIds: string[]): Promise<void>;
}
