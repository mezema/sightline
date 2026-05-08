export type ProviderName = "gemini" | "landingai";

export type PixelBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  coordinateSystem: "pixel";
};

export type Detection = {
  label: string;
  confidence?: number;
  box?: PixelBox;
  reason?: string;
};

export type AnalyzerInput = {
  referenceImagePath: string;
  targetImagePath: string;
  defectDescription: string;
  idempotencyKey: string;
};

export type AnalyzerResult = {
  provider: ProviderName;
  promptVersion?: string;
  targetImage: string;
  defectFound: boolean;
  detections: Detection[];
  latencyMs: number;
  rawResponse: unknown;
  error?: string;
};

export interface DefectAnalyzer {
  provider: ProviderName;
  analyze(input: AnalyzerInput): Promise<AnalyzerResult>;
}

export class AnalyzerError extends Error {
  readonly rawResponse?: unknown;

  constructor(message: string, rawResponse?: unknown) {
    super(message);
    this.name = "AnalyzerError";
    this.rawResponse = rawResponse;
  }
}
