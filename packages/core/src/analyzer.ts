export type AnalyzerBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  coordinateSystem: "pixel";
};

export type AnalyzerDetection = {
  label: string;
  confidence?: number;
  box?: AnalyzerBox;
  reason?: string;
};

export type AnalyzerImage = { kind: "url"; url: string } | { kind: "inline"; mimeType: string; bytes: Uint8Array };

export type AnalyzerInput = {
  referenceImage: AnalyzerImage;
  targetImage: AnalyzerImage;
  defectDescription: string;
  idempotencyKey: string;
};

export type AnalyzerOutput = {
  defectFound: boolean;
  detections: AnalyzerDetection[];
  rawResponse: unknown;
};

export interface DefectAnalyzer {
  analyze(input: AnalyzerInput): Promise<AnalyzerOutput>;
}

export class FakeDefectAnalyzer implements DefectAnalyzer {
  async analyze(input: AnalyzerInput): Promise<AnalyzerOutput> {
    const seed = stableHash(`${input.idempotencyKey}:${imageStableKey(input.targetImage)}:${input.defectDescription}`);
    const failed = seed % 17 === 0;
    if (failed) throw new Error("Fake analyzer timeout");

    const defectFound = seed % 3 !== 0;
    const x = 24 + (seed % 56);
    const y = 18 + ((seed >> 3) % 64);
    const width = 42 + ((seed >> 5) % 38);
    const height = 32 + ((seed >> 7) % 44);

    return {
      defectFound,
      detections: defectFound
        ? [
            {
              label: "defect",
              confidence: 0.72,
              box: {
                x1: x,
                y1: y,
                x2: x + width,
                y2: y + height,
                coordinateSystem: "pixel",
              },
              reason: "Deterministic fake result for workflow development.",
            },
          ]
        : [],
      rawResponse: {
        provider: "fake",
        seed,
        targetImage: imageStableKey(input.targetImage),
      },
    };
  }
}

function imageStableKey(image: AnalyzerImage) {
  if (image.kind === "url") return image.url;
  return `${image.mimeType}:${image.bytes.byteLength}`;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
