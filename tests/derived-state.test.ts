import test from "node:test";
import assert from "node:assert/strict";
import { deriveInspectionStatus, type ProcessingAttempt } from "../packages/core/src/index.ts";

const baseAttempt: ProcessingAttempt = {
  id: "attempt-1",
  inspectionId: "inspection-1",
  inspectionTargetId: "target-1",
  status: "queued",
  attempt: 1,
  idempotencyKey: "inspection-1:target-1:1",
};

test("deriveInspectionStatus treats terminal cancellation as cancelled", () => {
  assert.equal(deriveInspectionStatus([{ ...baseAttempt, status: "cancelled" }]), "cancelled");
  assert.equal(
    deriveInspectionStatus([
      { ...baseAttempt, id: "attempt-1", status: "succeeded" },
      { ...baseAttempt, id: "attempt-2", inspectionTargetId: "target-2", status: "cancelled" },
    ]),
    "cancelled",
  );
  assert.equal(
    deriveInspectionStatus([
      { ...baseAttempt, id: "attempt-1", status: "succeeded" },
      { ...baseAttempt, id: "attempt-2", inspectionTargetId: "target-2", status: "failed" },
      { ...baseAttempt, id: "attempt-3", inspectionTargetId: "target-3", status: "cancelled" },
    ]),
    "cancelled",
  );
});
