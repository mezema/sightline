import test from "node:test";
import assert from "node:assert/strict";
import { box1000ToPixels } from "../src/lib/image.ts";

test("converts Gemini 0..1000 yxyx boxes into pixel xyxy boxes", () => {
  assert.deepEqual(box1000ToPixels([100, 200, 500, 700], 1000, 500), {
    x1: 200,
    y1: 50,
    x2: 700,
    y2: 250,
    coordinateSystem: "pixel",
  });
});

test("clamps out-of-range Gemini box values", () => {
  assert.deepEqual(box1000ToPixels([-10, 900, 1005, 1100], 200, 100), {
    x1: 180,
    y1: 0,
    x2: 200,
    y2: 100,
    coordinateSystem: "pixel",
  });
});
