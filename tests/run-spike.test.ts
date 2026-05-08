import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, validateInputs } from "../src/run-spike.ts";

test("parses CLI arguments", () => {
  const config = parseArgs([
    "--description",
    "scratch",
    "--providers",
    "gemini",
    "--max-targets",
    "5",
  ]);

  assert.equal(config.description, "scratch");
  assert.deepEqual(config.providers, ["gemini"]);
  assert.equal(config.maxTargets, 5);
});

test("validation rejects more than 25 requested targets", () => {
  assert.throws(
    () =>
      validateInputs(
        {
          description: "scratch",
          providers: ["gemini"],
          referenceDir: "samples/reference",
          targetsDir: "samples/targets",
          outputDir: "outputs",
          maxTargets: 26,
        },
        ["reference.jpg"],
        ["target.jpg"],
      ),
    /--max-targets must be an integer from 1 to 25/,
  );
});

test("validation rejects folders with more than 25 target images", () => {
  assert.throws(
    () =>
      validateInputs(
        {
          description: "scratch",
          providers: ["gemini"],
          referenceDir: "samples/reference",
          targetsDir: "samples/targets",
          outputDir: "outputs",
          maxTargets: 25,
        },
        ["reference.jpg"],
        Array.from({ length: 26 }, (_, index) => `target-${index}.jpg`),
      ),
    /cannot contain more than 25 target images/,
  );
});
