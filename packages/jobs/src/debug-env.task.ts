import { task } from "@trigger.dev/sdk/v3";

const requiredEnvKeys = [
  "DATABASE_URL",
  "ANALYZER_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "SIGHTLINE_JOB_QUEUE",
  "TRIGGER_PROJECT_ID",
  "TRIGGER_SECRET_KEY",
] as const;

export const debugEnvTask = task({
  id: "debug-env",
  run: async () => {
    const report = Object.fromEntries(
      requiredEnvKeys.map((key) => {
        const value = process.env[key];
        return [
          key,
          {
            present: Boolean(value),
            length: value?.length ?? 0,
          },
        ];
      }),
    );
    console.log("Debug env report", report);
    return report;
  },
});
