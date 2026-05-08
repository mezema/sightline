import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGeminiDetections } from "../src/analyzers/gemini.ts";
import { normalizeLandingAIDetections } from "../src/analyzers/landingai.ts";

test("normalizes Gemini fixture detections", () => {
  const result = normalizeGeminiDetections(
    [{ defect_found: true, label: "scratch", confidence: 0.91, box_2d: [100, 200, 300, 400] }],
    1000,
    500,
  );

  assert.deepEqual(result, [
    {
      label: "scratch",
      confidence: 0.91,
      reason: undefined,
      box: {
        x1: 200,
        y1: 50,
        x2: 400,
        y2: 150,
        coordinateSystem: "pixel",
      },
    },
  ]);
});

test("normalizes common LandingAI pixel coordinate predictions", () => {
  const result = normalizeLandingAIDetections({
    predictions: [
      {
        label: "dent",
        score: 0.82,
        coordinates: { x1: 10, y1: 20, x2: 40, y2: 60 },
      },
    ],
  });

  assert.deepEqual(result, [
    {
      label: "dent",
      confidence: 0.82,
      box: {
        x1: 10,
        y1: 20,
        x2: 40,
        y2: 60,
        coordinateSystem: "pixel",
      },
    },
  ]);
});

test("keeps malformed provider detections visible without crashing normalization", () => {
  const result = normalizeLandingAIDetections({
    predictions: [{ class_name: "scratch", confidence: "0.7" }],
  });

  assert.deepEqual(result, [{ label: "scratch", confidence: 0.7, box: undefined }]);
});
