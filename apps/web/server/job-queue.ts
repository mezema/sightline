import { FakeDefectAnalyzer, GeminiDefectAnalyzer } from "@sightline/analyzer";
import { runProcessingAttempt, type DefectAnalyzer, type ObjectStorage } from "@sightline/core";
import { processFakeAttempt } from "@sightline/db/fake-processing";
import { createDrizzleProcessingStore } from "@sightline/db/processing-store";
import { enqueueProcessingAttempts } from "@sightline/jobs";
import type { JobQueue } from "./repository-contract";
import { getImageStorage } from "./storage";

export function createLocalJobQueue(databaseUrl: string): JobQueue {
  return {
    async enqueueAttempts(attemptIds) {
      void processSequentially(databaseUrl, attemptIds).catch((error: unknown) => {
        console.error("Local processing attempt failed", error);
      });
    },
  };
}

export function createInlineJobQueue(databaseUrl: string): JobQueue {
  return {
    async enqueueAttempts(attemptIds) {
      for (const attemptId of attemptIds) {
        await processAttempt(databaseUrl, attemptId);
      }
    },
  };
}

export function createTriggerJobQueue(): JobQueue {
  return {
    async enqueueAttempts(attemptIds) {
      await enqueueProcessingAttempts(attemptIds);
    },
  };
}

async function processSequentially(databaseUrl: string, attemptIds: string[]) {
  for (const attemptId of attemptIds) {
    await processAttempt(databaseUrl, attemptId);
  }
}

async function processAttempt(databaseUrl: string, attemptId: string) {
  const provider = process.env.ANALYZER_PROVIDER ?? "fake";
  if (provider === "gemini" || process.env.SIGHTLINE_GENERIC_FAKE_PROCESSOR === "1") {
    const analyzer = createAnalyzer(provider);
    const store = createDrizzleProcessingStore(databaseUrl);
    try {
      await runProcessingAttempt({
        attemptId,
        analyzer,
        analyzerProvider: provider === "gemini" ? "gemini" : "fake",
        analyzerVersion: provider === "gemini" ? process.env.GEMINI_MODEL ?? "gemini-2.5-flash" : "generic-dev-v1",
        storage: createAnalyzerStorage(getImageStorage()),
        store,
      });
    } finally {
      await store.close();
    }
    return;
  }
  await processFakeAttempt(databaseUrl, attemptId);
}

function createAnalyzer(provider: string): DefectAnalyzer {
  if (provider === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required when ANALYZER_PROVIDER=gemini.");
    return new GeminiDefectAnalyzer({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
      imageWidth: Number(process.env.SIGHTLINE_IMAGE_WIDTH ?? 256),
      imageHeight: Number(process.env.SIGHTLINE_IMAGE_HEIGHT ?? 180),
    });
  }
  return new FakeDefectAnalyzer();
}

function createAnalyzerStorage(storage: ObjectStorage): ObjectStorage {
  return {
    createUploadUrl: (input) => storage.createUploadUrl(input),
    exists: (storageKey) => storage.exists?.(storageKey) ?? Promise.resolve(true),
    head: (storageKey) => storage.head?.(storageKey) ?? Promise.resolve({}),
    readObject: storage.readObject ? (storageKey) => storage.readObject!(storageKey) : undefined,
    async createReadUrl(storageKey) {
      const url = await storage.createReadUrl(storageKey);
      if (url.startsWith("http://") || url.startsWith("https://")) return url;
      const baseUrl = process.env.SIGHTLINE_APP_URL;
      if (!baseUrl) throw new Error("SIGHTLINE_APP_URL is required for local analyzer image reads.");
      if (url.startsWith("/")) return new URL(url, baseUrl).toString();
      return new URL(`/api/images/${storageKey}`, baseUrl).toString();
    },
  };
}
