import type { AnalyzerImage, AnalyzerInput, AnalyzerOutput, DefectAnalyzer } from "@sightline/core";
import { z } from "zod";
import { geminiBox1000ToPixels } from "./normalize-boxes.ts";

const geminiDetectionSchema = z
  .object({
    defect_found: z.boolean().optional(),
    label: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    reason: z.string().optional(),
  })
  .passthrough();

const geminiDetectionListSchema = z.union([z.array(geminiDetectionSchema), z.object({ detections: z.array(geminiDetectionSchema) }).passthrough()]);

export class GeminiDefectAnalyzer implements DefectAnalyzer {
  private readonly input: {
    apiKey: string;
    model?: string;
    imageWidth: number;
    imageHeight: number;
    timeoutMs: number;
  };

  constructor(input: { apiKey: string; model?: string; imageWidth: number; imageHeight: number; timeoutMs?: number }) {
    this.input = { ...input, timeoutMs: input.timeoutMs ?? 60_000 };
  }

  async analyze(input: AnalyzerInput): Promise<AnalyzerOutput> {
    if (!this.input.apiKey) throw new Error("GEMINI_API_KEY is required.");
    const model = this.input.model ?? "gemini-2.5-flash";
    const [reference, target] = await Promise.all([
      readImageAsInlineData(input.referenceImage, this.input.timeoutMs),
      readImageAsInlineData(input.targetImage, this.input.timeoutMs),
    ]);
    const targetDimensions = imageDimensions(target.bytes, target.mimeType) ?? { width: this.input.imageWidth, height: this.input.imageHeight };

    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.input.apiKey}`,
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
                { inlineData: inlineDataPart(reference) },
                { text: "Target image to inspect:" },
                { inlineData: inlineDataPart(target) },
              ],
            },
          ],
        }),
      },
      this.input.timeoutMs,
      "Gemini request",
    );

    const rawResponse = await readJsonOrText(response);
    if (!response.ok) {
      throw new Error(`Gemini request failed with HTTP ${response.status}: ${summarizeProviderError(rawResponse)}`);
    }

    const text = readGeminiText(rawResponse);
    const parsed = parseGeminiDetections(text);
    const detections = parsed.flatMap((item) => {
      if (item.defect_found === false || !item.box_2d) return [];
      return [
        {
          label: item.label?.trim() || "defect",
          confidence: item.confidence,
          box: geminiBox1000ToPixels(item.box_2d, targetDimensions.width, targetDimensions.height),
          reason: item.reason,
        },
      ];
    });

    return {
      defectFound: detections.length > 0,
      detections,
      rawResponse: {
        response: rawResponse,
        provider: "gemini",
        model,
        referenceImage: rawImageSummary(input.referenceImage),
        targetImage: rawImageSummary(input.targetImage),
      },
    };
  }
}

export function parseGeminiDetections(text: string) {
  const parsed = geminiDetectionListSchema.parse(extractJson(text));
  return Array.isArray(parsed) ? parsed : parsed.detections;
}

export function buildGeminiPrompt(defectDescription: string): string {
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

async function readImageAsInlineData(image: AnalyzerImage, timeoutMs: number) {
  if (image.kind === "inline") {
    const bytes = Buffer.from(image.bytes);
    if (!image.mimeType.startsWith("image/")) throw new Error(`Gemini inline input is not an image: ${image.mimeType}.`);
    return {
      mimeType: image.mimeType,
      data: bytes.toString("base64"),
      bytes,
    };
  }

  return readUrlAsInlineData(image.url, timeoutMs);
}

async function readUrlAsInlineData(url: string, timeoutMs: number) {
  const response = await fetchWithTimeout(url, {}, timeoutMs, "Image read");
  if (!response.ok) throw new Error(`Could not read image URL ${url}: HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || mimeTypeFromUrl(url);
  if (!contentType.startsWith("image/")) throw new Error(`Gemini input URL did not return an image: ${contentType}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    mimeType: contentType,
    data: bytes.toString("base64"),
    bytes,
  };
}

function rawImageSummary(image: AnalyzerImage) {
  if (image.kind === "url") return { kind: "url" as const, url: image.url };
  return { kind: "inline" as const, mimeType: image.mimeType, byteSize: image.bytes.byteLength };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const host = safeHost(url);
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
    throw new Error(`${label} failed for ${host}: ${error instanceof Error ? error.message : String(error)}${cause}`);
  } finally {
    clearTimeout(timeout);
  }
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

function inlineDataPart(input: { mimeType: string; data: string }) {
  return {
    mimeType: input.mimeType,
    data: input.data,
  };
}

async function readJsonOrText(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function readGeminiText(raw: unknown): string {
  const candidate = (raw as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  })?.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;

  if (!candidate) {
    throw new Error("Gemini response did not include text content.");
  }

  return candidate;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);

    const firstArray = trimmed.indexOf("[");
    const lastArray = trimmed.lastIndexOf("]");
    if (firstArray !== -1 && lastArray > firstArray) {
      return JSON.parse(trimmed.slice(firstArray, lastArray + 1));
    }

    const firstObject = trimmed.indexOf("{");
    const lastObject = trimmed.lastIndexOf("}");
    if (firstObject !== -1 && lastObject > firstObject) {
      return JSON.parse(trimmed.slice(firstObject, lastObject + 1));
    }

    throw new Error("Gemini response did not contain parseable JSON.");
  }
}

function mimeTypeFromUrl(url: string) {
  const pathname = new URL(url, "http://local").pathname.toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function summarizeProviderError(raw: unknown) {
  if (!raw || typeof raw !== "object") return String(raw);
  const message = (raw as { error?: { message?: unknown }; text?: unknown }).error?.message ?? (raw as { text?: unknown }).text;
  return typeof message === "string" ? message : JSON.stringify(raw).slice(0, 500);
}

function imageDimensions(bytes: Buffer, mimeType: string): { width: number; height: number } | undefined {
  if (mimeType === "image/png" && bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  return undefined;
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return undefined;
}
