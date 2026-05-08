import { schedules } from "@trigger.dev/sdk/v3";
import { reconcileStuckInspections } from "@sightline/db/reconciler";

export const reconcileStuckInspectionsTask = schedules.task({
  id: "reconcile-stuck-inspections",
  cron: "*/15 * * * *",
  run: async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to reconcile inspections.");
    return reconcileStuckInspections({
      databaseUrl: process.env.DATABASE_URL,
      attemptTimeoutMs: Number(process.env.SIGHTLINE_ATTEMPT_TIMEOUT_MS ?? 5 * 60_000),
    });
  },
});
