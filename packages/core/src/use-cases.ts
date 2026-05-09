import type { AnalyzerImage, DefectAnalyzer } from "./analyzer.ts";
import { isTerminal } from "./derived-state.ts";
import type {
  Detection,
  Feedback,
  ImageAsset,
  Inspection,
  InspectionResult,
  InspectionTarget,
  ProcessingAttempt,
} from "./domain.ts";

export const maxTargetsPerInspection = 25;

export type CreateInspectionInput = {
  ownerUserId: string;
  defectDescription: string;
  referenceImage: Pick<ImageAsset, "originalFilename" | "mimeType" | "byteSize">;
  targets: Array<Pick<ImageAsset, "originalFilename" | "mimeType" | "byteSize">>;
};

export interface InspectionRepository {
  createInspection(input: CreateInspectionInput): Promise<Inspection>;
  createFeedback(input: Omit<Feedback, "id" | "createdAt">): Promise<Feedback>;
  retryTarget(input: { inspectionTargetId: string; actorUserId: string }): Promise<ProcessingAttempt>;
}

export interface InspectionQueries {
  listInspections(ownerUserId: string): Promise<Inspection[]>;
  getInspection(ownerUserId: string, inspectionId: string): Promise<Inspection | undefined>;
}

export interface ObjectStorage {
  createUploadUrl(input: {
    ownerUserId: string;
    inspectionId: string;
    imageAssetId: string;
    mimeType?: string;
  }): Promise<{ url: string; storageKey: string; headers?: Record<string, string>; method?: "PUT" }>;
  createReadUrl(storageKey: string): Promise<string>;
  writeObject?(storageKey: string, input: { bytes: Uint8Array; mimeType?: string }): Promise<void>;
  readObject?(storageKey: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  exists?(storageKey: string): Promise<boolean>;
  head?(storageKey: string): Promise<{ byteSize?: number; mimeType?: string }>;
}

export type SaveAnalyzerResultInput = {
  result: Omit<InspectionResult, "id" | "createdAt">;
  detections: Array<Omit<Detection, "id" | "createdAt" | "resultId">>;
};

export interface ProcessingStore {
  loadAttemptContext(attemptId: string): Promise<{
    attempt: ProcessingAttempt;
    inspection: Inspection;
    referenceImage: ImageAsset;
    target: InspectionTarget;
    targetImage: ImageAsset;
    defectDescription: string;
  }>;
  markAttemptRunning(attemptId: string): Promise<boolean>;
  saveAnalyzerResult(input: SaveAnalyzerResultInput): Promise<void>;
  saveAnalyzerFailure(input: { attemptId: string; error: string }): Promise<void>;
}

export async function runProcessingAttempt(input: {
  attemptId: string;
  analyzer: DefectAnalyzer;
  analyzerProvider?: string;
  analyzerVersion?: string;
  storage: ObjectStorage;
  store: ProcessingStore;
}) {
  const context = await input.store.loadAttemptContext(input.attemptId);
  if (isTerminal(context.attempt.status)) return;

  const canProcess = await input.store.markAttemptRunning(context.attempt.id);
  if (!canProcess) return;

  try {
    const [referenceImage, targetImage] = await Promise.all([
      readAnalyzerImage(input.storage, context.referenceImage.storageKey),
      readAnalyzerImage(input.storage, context.targetImage.storageKey),
    ]);
    const output = await input.analyzer.analyze({
      referenceImage,
      targetImage,
      defectDescription: context.defectDescription,
      idempotencyKey: context.attempt.idempotencyKey,
    });

    await input.store.saveAnalyzerResult({
      result: {
        inspectionId: context.inspection.id,
        inspectionTargetId: context.target.id,
        attemptId: context.attempt.id,
        defectFound: output.defectFound,
        rawAnalyzerResponse: output.rawResponse,
        analyzerProvider: input.analyzerProvider ?? "unknown",
        analyzerVersion: input.analyzerVersion,
        resultSchemaVersion: 1,
      },
      detections: output.detections
        .filter((detection) => detection.box)
        .map((detection) => ({
          inspectionId: context.inspection.id,
          inspectionTargetId: context.target.id,
          label: detection.label,
          confidence: detection.confidence,
          x1: detection.box!.x1,
          y1: detection.box!.y1,
          x2: detection.box!.x2,
          y2: detection.box!.y2,
          coordinateSystem: "pixel",
          reason: detection.reason,
        })),
    });
  } catch (error) {
    await input.store.saveAnalyzerFailure({
      attemptId: context.attempt.id,
      error: formatError(error),
    });
  }
}

async function readAnalyzerImage(storage: ObjectStorage, storageKey: string): Promise<AnalyzerImage> {
  if (storage.readObject) {
    const object = await storage.readObject(storageKey);
    return { kind: "inline", mimeType: object.mimeType, bytes: object.bytes };
  }
  return { kind: "url", url: await storage.createReadUrl(storageKey) };
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    const parts = [error.name, error.message].filter(Boolean);
    const cause = error.cause instanceof Error ? [error.cause.name, error.cause.message].filter(Boolean).join(": ") : undefined;
    if (cause) parts.push(`cause=${cause}`);
    return parts.join(": ") || "Unknown analyzer error.";
  }
  if (typeof error === "string" && error.trim()) return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown analyzer error.";
  }
}
