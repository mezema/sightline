import { and, eq, inArray, lt } from "drizzle-orm";
import { createDbConnection } from "./index.ts";
import { rebuildInspectionCounters } from "./fake-processing.ts";
import { inspectionEvents, inspections, processingAttempts } from "./schema/index.ts";

export async function reconcileStuckInspections(input: { databaseUrl?: string; attemptTimeoutMs?: number } = {}) {
  const connection = createDbConnection(input.databaseUrl);
  const db = connection.db;
  try {
    const timeoutMs = input.attemptTimeoutMs ?? 5 * 60_000;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - timeoutMs);
    const stuckAttempts = await db
      .select()
      .from(processingAttempts)
      .where(and(eq(processingAttempts.status, "running"), lt(processingAttempts.startedAt, staleBefore)));
    const queuedAttempts = await db.select().from(processingAttempts).where(eq(processingAttempts.status, "queued"));
    for (const attempt of queuedAttempts) {
      const [inspection] = await db.select().from(inspections).where(eq(inspections.id, attempt.inspectionId));
      const queuedSince = inspection?.submittedAt ?? inspection?.createdAt;
      if (queuedSince && queuedSince < staleBefore) {
        stuckAttempts.push(attempt);
      }
    }

    const repairedInspectionIds = new Set<string>();
    for (const attempt of stuckAttempts) {
      await db
        .update(processingAttempts)
        .set({
          status: "failed",
          lastError: `Processing attempt timed out after ${timeoutMs}ms.`,
          completedAt: now,
        })
        .where(eq(processingAttempts.id, attempt.id));
      await db.insert(inspectionEvents).values({
        inspectionId: attempt.inspectionId,
        kind: "attempt_failed",
        payload: { attemptId: attempt.id, error: "Reconciler marked stale attempt failed." },
        createdAt: now,
      });
      repairedInspectionIds.add(attempt.inspectionId);
    }

    const activeInspections = await db.select({ id: inspections.id }).from(inspections).where(inArray(inspections.status, ["queued", "processing"]));
    for (const inspection of activeInspections) {
      repairedInspectionIds.add(inspection.id);
    }

    for (const inspectionId of repairedInspectionIds) {
      await rebuildInspectionCounters(db, inspectionId);
    }

    return {
      checked: activeInspections.length,
      repaired: stuckAttempts.length,
    };
  } finally {
    await connection.close();
  }
}
