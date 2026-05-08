import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnalyzerResult, ProviderName } from "./analyzers/DefectAnalyzer.ts";

export async function writeReports(results: AnalyzerResult[], outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(join(outputDir, "report.md"), buildMarkdownReport(results));
}

export function buildMarkdownReport(results: AnalyzerResult[]): string {
  const providers = [...new Set(results.map((result) => result.provider))].sort();
  const lines = ["# Sightline Analyzer Spike Report", ""];

  lines.push("## Summary", "");
  lines.push("| Provider | Images | Success Rate | Failures | Detections | Malformed Boxes | Latency p50 | Latency p95 |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");

  for (const provider of providers) {
    const stats = summarizeProvider(results, provider);
    lines.push(`| ${provider} | ${stats.total} | ${stats.successRate}% | ${stats.failures} | ${stats.detectionCount} | ${stats.malformedBoxes} | ${stats.p50}ms | ${stats.p95}ms |`);
  }

  lines.push("", "## Per Image", "");
  lines.push("| Provider | Prompt | Target | Defect Found | Detections | Latency | Error |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | --- |");

  for (const result of results) {
    lines.push(`| ${result.provider} | ${result.promptVersion ?? "unknown"} | ${result.targetImage} | ${result.defectFound ? "yes" : "no"} | ${result.detections.length} | ${result.latencyMs}ms | ${result.error ?? ""} |`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function summarizeProvider(results: AnalyzerResult[], provider: ProviderName) {
  const providerResults = results.filter((result) => result.provider === provider);
  const failures = providerResults.filter((result) => result.error).length;
  const latencies = providerResults.map((result) => result.latencyMs).sort((a, b) => a - b);
  const detectionCount = providerResults.reduce((sum, result) => sum + result.detections.length, 0);
  const malformedBoxes = providerResults.reduce(
    (sum, result) => sum + result.detections.filter((detection) => !detection.box).length,
    0,
  );

  return {
    total: providerResults.length,
    failures,
    successRate: providerResults.length === 0 ? 0 : Math.round(((providerResults.length - failures) / providerResults.length) * 100),
    detectionCount,
    malformedBoxes,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
  };
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * percentileValue) - 1);
  return sortedValues[index];
}
