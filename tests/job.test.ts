import test from "node:test";
import assert from "node:assert/strict";
import { deriveJobStatus } from "../src/prototype/job.ts";

const success = { error: undefined };
const failure = { error: "timeout" };

test("deriveJobStatus reports processing while results are incomplete", () => {
  assert.equal(deriveJobStatus(3, []), "processing");
  assert.equal(deriveJobStatus(3, [success as never]), "processing");
});

test("deriveJobStatus reports completed when all tasks succeed", () => {
  assert.equal(deriveJobStatus(2, [success as never, success as never]), "completed");
});

test("deriveJobStatus reports failed when every task fails", () => {
  assert.equal(deriveJobStatus(2, [failure as never, failure as never]), "failed");
});

test("deriveJobStatus reports partially_failed for mixed terminal results", () => {
  assert.equal(deriveJobStatus(2, [success as never, failure as never]), "partially_failed");
});
