import { basename } from "node:path";
import { AnalyzerError, type AnalyzerInput, type AnalyzerResult, type DefectAnalyzer, type Detection, type PixelBox } from "./DefectAnalyzer.ts";
import { readFileAsBase64 } from "../lib/files.ts";

type LandingPrediction = Record<string, unknown>;

export class LandingAIAnalyzer implements DefectAnalyzer {
  provider = "landingai" as const;
  readonly promptVersion = "landingai-adapter-v1";
  private readonly apiKey?: string;
  private readonly endpointId?: string;
  private readonly baseUrl: string;

  constructor(
    apiKey = process.env.LANDINGAI_API_KEY,
    endpointId = process.env.LANDINGAI_ENDPOINT_ID,
    baseUrl = process.env.LANDINGAI_BASE_URL ?? "https://api.va.landing.ai/v1/tools/agentic-object-detection",
  ) {
    this.apiKey = apiKey;
    this.endpointId = endpointId;
    this.baseUrl = baseUrl;
  }

  async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
    const started = performance.now();

    try {
      if (!this.apiKey) {
        throw new AnalyzerError("LANDINGAI_API_KEY is required for LandingAI analysis.");
      }
      if (!this.endpointId && !process.env.LANDINGAI_ENDPOINT_URL) {
        throw new AnalyzerError("LANDINGAI_ENDPOINT_ID or LANDINGAI_ENDPOINT_URL is required for LandingAI analysis.");
      }

      const endpointUrl = process.env.LANDINGAI_ENDPOINT_URL ?? this.baseUrl;
      const targetBase64 = await readFileAsBase64(input.targetImagePath);
      const referenceBase64 = await readFileAsBase64(input.referenceImagePath);

      const response = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify({
          endpoint_id: this.endpointId,
          idempotency_key: input.idempotencyKey,
          image: targetBase64,
          reference_image: referenceBase64,
          prompt: input.defectDescription,
        }),
      });

      const raw = await response.json().catch(async () => ({ text: await response.text() }));
      if (!response.ok) {
        throw new AnalyzerError(`LandingAI request failed with HTTP ${response.status}.`, raw);
      }

      const detections = normalizeLandingAIDetections(raw);

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

export function normalizeLandingAIDetections(raw: unknown): Detection[] {
  const predictions = findPredictionArray(raw);

  return predictions.flatMap((prediction): Detection[] => {
    const label = readString(prediction, ["label", "class", "class_name", "name"]) ?? "defect";
    const confidence = readNumber(prediction, ["confidence", "score", "probability"]);
    const box = readPixelBox(prediction);

    return [{ label, confidence, box }];
  });
}

function findPredictionArray(raw: unknown): LandingPrediction[] {
  const object = raw as Record<string, unknown>;
  const candidates = [
    object.predictions,
    object.detections,
    object.results,
    object.data,
    (object.result as Record<string, unknown> | undefined)?.predictions,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as LandingPrediction[];
  }

  return [];
}

function readPixelBox(prediction: LandingPrediction): PixelBox | undefined {
  const coordinates = prediction.coordinates;
  if (isCoordinateObject(coordinates)) {
    return normalizeCorners(coordinates.x1, coordinates.y1, coordinates.x2, coordinates.y2);
  }

  const box = prediction.box ?? prediction.bbox ?? prediction.bounding_box;
  if (isCoordinateObject(box)) {
    const width = readMaybeNumber(box.width ?? box.w);
    const height = readMaybeNumber(box.height ?? box.h);
    const x = readMaybeNumber(box.x);
    const y = readMaybeNumber(box.y);

    if (width !== undefined && height !== undefined && x !== undefined && y !== undefined) {
      return normalizeCorners(x, y, x + width, y + height);
    }

    return normalizeCorners(box.x1, box.y1, box.x2, box.y2);
  }

  if (Array.isArray(box) && box.length === 4) {
    return normalizeCorners(box[0], box[1], box[2], box[3]);
  }

  return undefined;
}

function normalizeCorners(x1Value: unknown, y1Value: unknown, x2Value: unknown, y2Value: unknown): PixelBox | undefined {
  const x1 = readMaybeNumber(x1Value);
  const y1 = readMaybeNumber(y1Value);
  const x2 = readMaybeNumber(x2Value);
  const y2 = readMaybeNumber(y2Value);

  if ([x1, y1, x2, y2].some((value) => value === undefined)) return undefined;

  return {
    x1: Math.round(Math.min(x1!, x2!)),
    y1: Math.round(Math.min(y1!, y2!)),
    x2: Math.round(Math.max(x1!, x2!)),
    y2: Math.round(Math.max(y1!, y2!)),
    coordinateSystem: "pixel",
  };
}

function readString(object: LandingPrediction, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readNumber(object: LandingPrediction, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readMaybeNumber(object[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readMaybeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function isCoordinateObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
