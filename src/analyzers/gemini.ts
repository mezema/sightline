import { basename } from "node:path";
import { AnalyzerError, type AnalyzerInput, type AnalyzerResult, type DefectAnalyzer, type Detection } from "./DefectAnalyzer.ts";
import { box1000ToPixels, getImageDimensions } from "../lib/image.ts";
import { readImageAsInlineData } from "../lib/files.ts";
import { extractJson } from "../lib/json.ts";

type GeminiDetection = {
  label?: unknown;
  confidence?: unknown;
  defect_found?: unknown;
  box_2d?: unknown;
  reason?: unknown;
};

export class GeminiAnalyzer implements DefectAnalyzer {
  provider = "gemini" as const;
  readonly promptVersion = process.env.GEMINI_PROMPT_VERSION ?? "broad-recall-v1";
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
    const started = performance.now();

    try {
      if (!this.apiKey) {
        throw new AnalyzerError("GEMINI_API_KEY is required for Gemini analysis.");
      }

      const [reference, target] = await Promise.all([
        readImageAsInlineData(input.referenceImagePath),
        readImageAsInlineData(input.targetImagePath),
      ]);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            generationConfig: {
              temperature: 0,
              responseMimeType: "application/json",
            },
            contents: [
              {
                role: "user",
                parts: [
                  { text: buildGeminiPrompt(input.defectDescription) },
                  { text: "Reference image showing the defect of interest:" },
                  { inlineData: reference },
                  { text: "Target image to inspect:" },
                  { inlineData: target },
                ],
              },
            ],
          }),
        },
      );

      const raw = await response.json().catch(async () => ({ text: await response.text() }));
      if (!response.ok) {
        throw new AnalyzerError(`Gemini request failed with HTTP ${response.status}.`, raw);
      }

      const text = readGeminiText(raw);
      const parsed = extractJson(text);
      const dimensions = await getImageDimensions(input.targetImagePath);
      const detections = normalizeGeminiDetections(parsed, dimensions.width, dimensions.height);

      return {
        provider: this.provider,
        promptVersion: this.promptVersion,
        targetImage: basename(input.targetImagePath),
        defectFound: detections.length > 0,
        detections,
        latencyMs: Math.round(performance.now() - started),
        rawResponse: raw,
      };
    } catch (error) {
      return {
        provider: this.provider,
        promptVersion: this.promptVersion,
        targetImage: basename(input.targetImagePath),
        defectFound: false,
        detections: [],
        latencyMs: Math.round(performance.now() - started),
        rawResponse: error instanceof AnalyzerError ? error.rawResponse ?? null : null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function normalizeGeminiDetections(raw: unknown, imageWidth: number, imageHeight: number): Detection[] {
  const items = Array.isArray(raw) ? raw : Array.isArray((raw as { detections?: unknown })?.detections) ? (raw as { detections: unknown[] }).detections : [];

  return items.flatMap((item): Detection[] => {
    const detection = item as GeminiDetection;
    const label = typeof detection.label === "string" && detection.label.trim() ? detection.label.trim() : "defect";
    const confidence = typeof detection.confidence === "number" ? clamp(detection.confidence, 0, 1) : undefined;
    const reason = typeof detection.reason === "string" && detection.reason.trim() ? detection.reason.trim() : undefined;
    const defectFound = typeof detection.defect_found === "boolean" ? detection.defect_found : true;

    if (!defectFound) return [];

    const box = Array.isArray(detection.box_2d) && detection.box_2d.length === 4
      ? box1000ToPixels(detection.box_2d, imageWidth, imageHeight)
      : undefined;

    return [{ label, confidence, box, reason }];
  });
}

function buildGeminiPrompt(defectDescription: string): string {
  return [
    "Find defects in the target image that are visually similar to the reference defect.",
    `Defect description: ${defectDescription}`,
    "Return JSON only. Use this exact shape:",
    `[{"defect_found":true,"label":"scratch","confidence":0.0,"box_2d":[y0,x0,y1,x1],"reason":"brief explanation"}]`,
    "The box_2d coordinates must be integers normalized from 0 to 1000 in [y0, x0, y1, x1] order.",
    "The box should cover the visible defect region. It may include nearby context, but it should not cover the entire image unless the defect spans the entire image.",
    "If no similar defect appears, return [].",
  ].join("\n");
}

function readGeminiText(raw: unknown): string {
  const candidate = (raw as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  })?.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;

  if (!candidate) {
    throw new AnalyzerError("Gemini response did not include text content.", raw);
  }

  return candidate;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
