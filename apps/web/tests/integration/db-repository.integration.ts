import { applyMigrations } from "@sightline/db/migrations";
import { createDrizzleProcessingStore } from "@sightline/db/processing-store";
import { runProcessingAttempt } from "@sightline/core";
import { buildReview } from "../../server/review.ts";
import { createDrizzleInspectionRepository } from "../../server/db-repository.ts";
import { createInlineJobQueue } from "../../server/job-queue.ts";

const databaseUrl = process.env.DATABASE_URL;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
  }
}

async function main() {
  if (!databaseUrl) {
    console.log("DATABASE_URL not set; skipping DB integration tests.");
    return;
  }

  await applyMigrations(databaseUrl);
  const repository = createDrizzleInspectionRepository(databaseUrl, undefined, createInlineJobQueue(databaseUrl));

  let inspection = await repository.createInspection({
    description: `integration scratch defect ${Date.now()}`,
    targetFilenames: Array.from({ length: 5 }, (_, index) => `integration-target-${index + 1}.jpg`),
  });

  for (let index = 0; index < 8 && inspection.status === "processing"; index += 1) {
    inspection = (await repository.getInspection(inspection.id)) ?? inspection;
  }

  assertEqual(inspection.processedCount, 5, "All fake analyzer attempts should reach a terminal state");
  assertEqual(inspection.failedCount, 1, "The deterministic fake analyzer should leave one failed target");
  assertEqual(buildReview(inspection).targets.filter((target) => target.bucket === "defect").length, 2, "Two targets should land in the Defect bucket");

  const firstDefect = buildReview(inspection).targets.find((target) => target.bucket === "defect");
  assert(firstDefect, "Expected a defect target to mark wrong");
  inspection = await repository.createFeedback({
    inspectionId: inspection.id,
    targetId: firstDefect.id,
    verdict: "wrong",
  });
  assertEqual(buildReview(inspection).targets.filter((target) => target.bucket === "defect").length, 1, "Wrong feedback should remove one target from the Defect bucket");

  const failed = buildReview(inspection).targets.find((target) => target.bucket === "failed");
  assert(failed, "Expected a failed target to retry");
  inspection = await repository.retryTarget({
    inspectionId: inspection.id,
    targetId: failed.id,
  });
  inspection = (await repository.getInspection(inspection.id)) ?? inspection;

  assertEqual(inspection.failedCount, 0, "Retrying the deterministic failed target should clear failedCount");
  assertEqual(buildReview(inspection).targets.filter((target) => target.bucket === "failed").length, 0, "Retry should remove the target from the Failed bucket");

  const uploadRepository = createDrizzleInspectionRepository(databaseUrl, testStorage, createInlineJobQueue(databaseUrl));
  const uploadSession = await uploadRepository.createUploadSession({
    description: `integration upload defect ${Date.now()}`,
    reference: { filename: "reference.png", mimeType: "image/png", byteSize: 128 },
    targets: [
      { filename: "upload-target-1.png", mimeType: "image/png", byteSize: 128 },
      { filename: "upload-target-2.png", mimeType: "image/png", byteSize: 128 },
    ],
  });
  inspection = await uploadRepository.completeUploads({
    inspectionId: uploadSession.inspectionId,
    imageAssetIds: uploadSession.uploads.map((upload) => upload.imageAssetId),
  });

  assertEqual(inspection.targetCount, 2, "Completing uploads should create one stable target per target image");
  assertEqual(inspection.processedCount, 2, "Completing uploads should enqueue and process one attempt per uploaded target");
  assertEqual(inspection.targets[0]?.image.originalFilename, "upload-target-1.png", "Uploaded target filenames should be persisted");

  const genericRepository = createDrizzleInspectionRepository(databaseUrl, testStorage);
  const genericSession = await genericRepository.createUploadSession({
    description: `generic analyzer defect ${Date.now()}`,
    reference: { filename: "generic-reference.png", mimeType: "image/png", byteSize: 128 },
    targets: [{ filename: "generic-target.png", mimeType: "image/png", byteSize: 128 }],
  });
  inspection = await genericRepository.completeUploads({
    inspectionId: genericSession.inspectionId,
    imageAssetIds: genericSession.uploads.map((upload) => upload.imageAssetId),
  });
  const queuedAttempt = inspection.attempts[0];
  assert(queuedAttempt, "Expected a queued attempt for the generic processor");
  assertEqual(queuedAttempt.status, "queued", "Attempts should remain queued until a worker starts processing them");
  await runProcessingAttempt({
    attemptId: queuedAttempt.id,
    analyzerProvider: "integration",
    analyzerVersion: "test-v1",
    analyzer: {
      async analyze() {
        return {
          defectFound: true,
          detections: [
            {
              label: "defect",
              confidence: 0.9,
              box: { x1: 10, y1: 12, x2: 80, y2: 72, coordinateSystem: "pixel" },
              reason: "integration analyzer result",
            },
          ],
          rawResponse: { provider: "integration" },
        };
      },
    },
    storage: testStorage,
    store: createDrizzleProcessingStore(databaseUrl),
  });
  inspection = (await genericRepository.getInspection(genericSession.inspectionId)) ?? inspection;
  assertEqual(inspection.processedCount, 1, "Generic processing store should mark the attempt terminal");
  assertEqual(inspection.defectCount, 1, "Generic processing store should persist analyzer detections");

  console.log(`DB integration workflow passed for inspection ${inspection.id}.`);
}

const testStorage = {
  async createUploadUrl(input: { ownerUserId: string; inspectionId: string; imageAssetId: string; mimeType?: string }) {
    return {
      storageKey: `integration/${input.ownerUserId}/${input.inspectionId}/${input.imageAssetId}`,
      url: `/api/uploads/${input.imageAssetId}`,
      method: "PUT" as const,
      headers: input.mimeType ? { "content-type": input.mimeType } : ({} as Record<string, string>),
    };
  },
  async createReadUrl(storageKey: string) {
    return storageKey;
  },
  async exists() {
    return true;
  },
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
