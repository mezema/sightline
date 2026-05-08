import { tasks } from "@trigger.dev/sdk/v3";
import type { processAttemptTask } from "./process-attempt.task.ts";

export async function enqueueProcessingAttempts(attemptIds: string[]) {
  if (attemptIds.length === 0) return;

  await tasks.batchTrigger<typeof processAttemptTask>(
    "process-attempt",
    attemptIds.map((attemptId) => ({
      payload: { processingAttemptId: attemptId },
      options: {
        tags: [`attempt:${attemptId}`],
      },
    })),
  );
}
