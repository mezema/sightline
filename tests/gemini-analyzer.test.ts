import test from "node:test";
import assert from "node:assert/strict";
import { GeminiDefectAnalyzer, parseGeminiDetections } from "../packages/analyzer/src/gemini-analyzer.ts";

test("parses Gemini fenced JSON detections", () => {
  assert.deepEqual(parseGeminiDetections('```json\n[{"defect_found":true,"label":"crack","confidence":0.8,"box_2d":[100,200,300,400]}]\n```'), [
    {
      defect_found: true,
      label: "crack",
      confidence: 0.8,
      box_2d: [100, 200, 300, 400],
    },
  ]);
});

test("calls Gemini with inline image data and normalizes boxes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.contents[0].parts.filter((part: { inlineData?: unknown }) => part.inlineData).length, 2);
      return responseJson({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([{ defect_found: true, label: "scratch", confidence: 0.91, box_2d: [100, 200, 300, 400], reason: "match" }]),
                },
              ],
            },
          },
        ],
      });
    }
    return new Response(Buffer.from("image"), { status: 200, headers: { "content-type": "image/png" } });
  };

  try {
    const result = await new GeminiDefectAnalyzer({ apiKey: "test-key", imageWidth: 1000, imageHeight: 500 }).analyze({
      referenceImage: { kind: "url", url: "https://example.com/reference.png" },
      targetImage: { kind: "inline", mimeType: "image/png", bytes: new Uint8Array(Buffer.from("image")) },
      defectDescription: "surface scratch",
      idempotencyKey: "attempt-1",
    });

    assert.equal(result.defectFound, true);
    assert.deepEqual(result.detections[0]?.box, { x1: 200, y1: 50, x2: 400, y2: 150, coordinateSystem: "pixel" });
    assert.ok(calls.some((call) => call.url.includes("gemini-2.5-flash:generateContent")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws when Gemini returns no text content", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes("generativelanguage.googleapis.com")) return responseJson({ candidates: [{ content: { parts: [] } }] });
    return new Response(Buffer.from("image"), { status: 200, headers: { "content-type": "image/png" } });
  };

  try {
    await assert.rejects(
      () =>
        new GeminiDefectAnalyzer({ apiKey: "test-key", imageWidth: 1000, imageHeight: 500 }).analyze({
          referenceImage: { kind: "inline", mimeType: "image/png", bytes: new Uint8Array(Buffer.from("image")) },
          targetImage: { kind: "inline", mimeType: "image/png", bytes: new Uint8Array(Buffer.from("image")) },
          defectDescription: "surface scratch",
          idempotencyKey: "attempt-1",
        }),
      /text content/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function responseJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
