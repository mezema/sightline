import { task } from "@trigger.dev/sdk/v3";
import { FakeDefectAnalyzer, GeminiDefectAnalyzer } from "@sightline/analyzer";
import { runProcessingAttempt, type DefectAnalyzer, type ObjectStorage } from "@sightline/core";
import { processFakeAttempt } from "@sightline/db/fake-processing";
import { createDrizzleProcessingStore } from "@sightline/db/processing-store";
import { R2ImageStorage } from "@sightline/storage";

export const processAttemptTask = task({
  id: "process-attempt",
  queue: {
    concurrencyLimit: 3,
  },
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: { processingAttemptId: string }) => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to process attempts.");
    console.log("Processing attempt started", { processingAttemptId: payload.processingAttemptId, provider: process.env.ANALYZER_PROVIDER ?? "fake" });
    const provider = process.env.ANALYZER_PROVIDER ?? "fake";
    if (provider === "gemini" || process.env.SIGHTLINE_GENERIC_FAKE_PROCESSOR === "1") {
      const store = createDrizzleProcessingStore(process.env.DATABASE_URL);
      try {
        await runProcessingAttempt({
          attemptId: payload.processingAttemptId,
          analyzer: provider === "gemini" ? createAnalyzer() : new FakeDefectAnalyzer(),
          analyzerProvider: provider === "gemini" ? "gemini" : "fake",
          analyzerVersion: provider === "gemini" ? process.env.GEMINI_MODEL ?? "gemini-2.5-flash" : "generic-dev-v1",
          storage: createStorage(),
          store,
        });
      } finally {
        await store.close();
      }
    } else {
      await processFakeAttempt(process.env.DATABASE_URL, payload.processingAttemptId);
    }
    console.log("Processing attempt finished", { processingAttemptId: payload.processingAttemptId });
    return {
      processingAttemptId: payload.processingAttemptId,
      status: "processed",
    };
  },
});

function createAnalyzer(): DefectAnalyzer {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required when ANALYZER_PROVIDER=gemini.");
  return new GeminiDefectAnalyzer({
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL,
    imageWidth: Number(process.env.SIGHTLINE_IMAGE_WIDTH ?? 256),
    imageHeight: Number(process.env.SIGHTLINE_IMAGE_HEIGHT ?? 180),
  });
}

function createStorage(): ObjectStorage {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (accountId && accessKeyId && secretAccessKey && bucket) {
    const storage = new R2ImageStorage({ accountId, accessKeyId, secretAccessKey, bucket });
    return {
      createUploadUrl: (input) => storage.createUploadUrl(input),
      createReadUrl: (storageKey) => storage.createReadUrl(storageKey),
      readObject: (storageKey) => storage.readObject(storageKey),
      exists: (storageKey) => storage.exists(storageKey),
      head: (storageKey) => storage.head(storageKey),
    };
  }
  return {
    async createUploadUrl(input) {
      return { storageKey: input.imageAssetId, url: `/api/uploads/${input.imageAssetId}`, method: "PUT" };
    },
    async createReadUrl(storageKey) {
      return storageKey.startsWith("/") ? storageKey : `/api/images/${storageKey}`;
    },
    async exists() {
      return true;
    },
  };
}
