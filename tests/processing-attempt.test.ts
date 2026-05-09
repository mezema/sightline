import test from "node:test";
import assert from "node:assert/strict";
import { runProcessingAttempt, type ObjectStorage, type ProcessingAttempt, type ProcessingStore } from "../packages/core/src/index.ts";

const queuedAttempt: ProcessingAttempt = {
  id: "attempt-1",
  inspectionId: "inspection-1",
  inspectionTargetId: "target-1",
  status: "queued",
  attempt: 1,
  idempotencyKey: "inspection-1:target-1:1",
};

test("runProcessingAttempt skips terminal attempts", async () => {
  let analyzeCalls = 0;
  let savedResults = 0;
  const store = createStore({
    attempt: { ...queuedAttempt, status: "cancelled" },
    markAttemptRunning: async () => true,
    saveAnalyzerResult: async () => {
      savedResults += 1;
    },
  });

  await runProcessingAttempt({
    attemptId: queuedAttempt.id,
    analyzer: {
      async analyze() {
        analyzeCalls += 1;
        return { defectFound: false, detections: [], rawResponse: {} };
      },
    },
    storage: unreachableStorage,
    store,
  });

  assert.equal(analyzeCalls, 0);
  assert.equal(savedResults, 0);
});

test("runProcessingAttempt stops when the store refuses the running transition", async () => {
  let analyzeCalls = 0;
  const store = createStore({
    attempt: queuedAttempt,
    markAttemptRunning: async () => false,
  });

  await runProcessingAttempt({
    attemptId: queuedAttempt.id,
    analyzer: {
      async analyze() {
        analyzeCalls += 1;
        return { defectFound: false, detections: [], rawResponse: {} };
      },
    },
    storage: unreachableStorage,
    store,
  });

  assert.equal(analyzeCalls, 0);
});

function createStore(overrides: {
  attempt: ProcessingAttempt;
  markAttemptRunning: ProcessingStore["markAttemptRunning"];
  saveAnalyzerResult?: ProcessingStore["saveAnalyzerResult"];
}): ProcessingStore {
  return {
    async loadAttemptContext() {
      return {
        attempt: overrides.attempt,
        inspection: {
          id: "inspection-1",
          ownerUserId: "owner-1",
          defectSpecId: "spec-1",
          status: "processing",
          targetCount: 1,
          processedCount: 0,
          failedCount: 0,
          defectCount: 0,
          createdAt: new Date(0).toISOString(),
        },
        referenceImage: imageAsset("reference-1", "reference"),
        target: {
          id: "target-1",
          inspectionId: "inspection-1",
          targetImageId: "target-image-1",
          position: 0,
          latestAttemptId: overrides.attempt.id,
          createdAt: new Date(0).toISOString(),
        },
        targetImage: imageAsset("target-image-1", "target"),
        defectDescription: "surface crack",
      };
    },
    markAttemptRunning: overrides.markAttemptRunning,
    saveAnalyzerResult: overrides.saveAnalyzerResult ?? (async () => undefined),
    saveAnalyzerFailure: async () => undefined,
  };
}

function imageAsset(id: string, kind: "reference" | "target") {
  return {
    id,
    ownerUserId: "owner-1",
    inspectionId: "inspection-1",
    kind,
    storageKey: id,
    originalFilename: `${id}.png`,
    mimeType: "image/png",
    byteSize: 1,
    uploadStatus: "verified" as const,
    createdAt: new Date(0).toISOString(),
  };
}

const unreachableStorage: ObjectStorage = {
  async createUploadUrl() {
    throw new Error("Unexpected upload URL request.");
  },
  async createReadUrl() {
    throw new Error("Unexpected read URL request.");
  },
};
