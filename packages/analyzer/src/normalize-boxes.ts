import type { AnalyzerBox } from "@sightline/core";

export function geminiBox1000ToPixels(box: [number, number, number, number], imageWidth: number, imageHeight: number): AnalyzerBox {
  const [y0, x0, y1, x1] = box;
  return {
    x1: clamp(Math.round((x0 / 1000) * imageWidth), 0, imageWidth),
    y1: clamp(Math.round((y0 / 1000) * imageHeight), 0, imageHeight),
    x2: clamp(Math.round((x1 / 1000) * imageWidth), 0, imageWidth),
    y2: clamp(Math.round((y1 / 1000) * imageHeight), 0, imageHeight),
    coordinateSystem: "pixel",
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
