import { createDrizzleInspectionRepository } from "./db-repository";
import { devRepository } from "./dev-repository";
import { createLocalJobQueue, createTriggerJobQueue } from "./job-queue";
import type { InspectionWorkflowRepository } from "./repository-contract";
import { getImageStorage } from "./storage";

let cachedRepository: InspectionWorkflowRepository | undefined;

export function getInspectionRepository() {
  if (cachedRepository) return cachedRepository;
  cachedRepository = process.env.DATABASE_URL
    ? createDrizzleInspectionRepository(process.env.DATABASE_URL, getImageStorage(), createJobQueue(process.env.DATABASE_URL))
    : devRepository;
  return cachedRepository;
}

function createJobQueue(databaseUrl: string) {
  if (process.env.SIGHTLINE_JOB_QUEUE === "trigger") {
    if (!process.env.TRIGGER_SECRET_KEY) throw new Error("TRIGGER_SECRET_KEY is required when SIGHTLINE_JOB_QUEUE=trigger.");
    return createTriggerJobQueue();
  }

  return createLocalJobQueue(databaseUrl);
}
