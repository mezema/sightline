import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GeminiAnalyzer } from "./analyzers/gemini.ts";
import { LandingAIAnalyzer } from "./analyzers/landingai.ts";
import type { AnalyzerResult, DefectAnalyzer, ProviderName } from "./analyzers/DefectAnalyzer.ts";
import { listImages } from "./lib/files.ts";
import { writeReports } from "./report.ts";

type CliConfig = {
  description: string;
  providers: ProviderName[];
  referenceDir: string;
  targetsDir: string;
  outputDir: string;
  maxTargets: number;
};

const defaultConfig: CliConfig = {
  description: "",
  providers: ["gemini", "landingai"],
  referenceDir: "samples/reference",
  targetsDir: "samples/targets",
  outputDir: "outputs",
  maxTargets: 25,
};

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const referenceImages = await listImages(resolve(config.referenceDir));
  const allTargetImages = await listImages(resolve(config.targetsDir));

  validateInputs(config, referenceImages, allTargetImages);
  const targetImages = allTargetImages.slice(0, config.maxTargets);
  await mkdir(resolve(config.outputDir), { recursive: true });

  const analyzers = createAnalyzers(config.providers);
  const results: AnalyzerResult[] = [];
  const runId = createRunId();

  for (const analyzer of analyzers) {
    for (const targetImagePath of targetImages) {
      const idempotencyKey = `${analyzer.provider}:${referenceImages[0]}:${targetImagePath}:v1`;
      console.log(`[${analyzer.provider}] analyzing ${targetImagePath}`);
      const result = await analyzer.analyze({
        referenceImagePath: referenceImages[0],
        targetImagePath,
        defectDescription: config.description,
        idempotencyKey,
      });
      results.push(result);

      if (result.error) {
        console.warn(`[${analyzer.provider}] ${result.targetImage} failed: ${result.error}`);
      } else {
        console.log(`[${analyzer.provider}] ${result.targetImage}: ${result.detections.length} detections in ${result.latencyMs}ms`);
      }
    }
  }

  const outputDir = resolve(config.outputDir);
  const runOutputDir = join(outputDir, "runs", runId);
  await writeReports(results, outputDir);
  await writeReports(results, runOutputDir);
  await writeRunMetadata(outputDir, runOutputDir, runId, config, results);
  console.log(`Wrote ${resolve(config.outputDir, "results.json")}`);
  console.log(`Wrote ${resolve(config.outputDir, "report.md")}`);
  console.log(`Archived run in ${runOutputDir}`);
}

export function parseArgs(args: string[]): CliConfig {
  const config = { ...defaultConfig };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--description") {
      config.description = requireValue(arg, next);
      index += 1;
    } else if (arg === "--providers") {
      config.providers = requireValue(arg, next).split(",").map((provider) => {
        const normalized = provider.trim();
        if (normalized !== "gemini" && normalized !== "landingai") {
          throw new Error(`Unsupported provider "${provider}". Use gemini, landingai, or both comma-separated.`);
        }
        return normalized;
      });
      index += 1;
    } else if (arg === "--reference-dir") {
      config.referenceDir = requireValue(arg, next);
      index += 1;
    } else if (arg === "--targets-dir") {
      config.targetsDir = requireValue(arg, next);
      index += 1;
    } else if (arg === "--output-dir") {
      config.outputDir = requireValue(arg, next);
      index += 1;
    } else if (arg === "--max-targets") {
      config.maxTargets = Number(requireValue(arg, next));
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}

export function validateInputs(config: CliConfig, referenceImages: string[], targetImages: string[]): void {
  if (!config.description.trim()) {
    throw new Error('Missing --description "defect to find".');
  }
  if (referenceImages.length !== 1) {
    throw new Error(`Expected exactly one reference image in ${config.referenceDir}; found ${referenceImages.length}.`);
  }
  if (targetImages.length === 0) {
    throw new Error(`Expected at least one target image in ${config.targetsDir}.`);
  }
  if (!Number.isInteger(config.maxTargets) || config.maxTargets < 1 || config.maxTargets > 25) {
    throw new Error("--max-targets must be an integer from 1 to 25.");
  }
  if (targetImages.length > 25) {
    throw new Error("A spike batch cannot contain more than 25 target images.");
  }
}

function createAnalyzers(providers: ProviderName[]): DefectAnalyzer[] {
  return providers.map((provider) => {
    if (provider === "gemini") return new GeminiAnalyzer();
    return new LandingAIAnalyzer();
  });
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function printHelpAndExit(): never {
  console.log(`Usage: node src/run-spike.ts --description "scratch near left edge"

Options:
  --providers gemini,landingai
  --reference-dir samples/reference
  --targets-dir samples/targets
  --output-dir outputs
  --max-targets 25`);
  process.exit(0);
}

function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeRunMetadata(
  outputDir: string,
  runOutputDir: string,
  runId: string,
  config: CliConfig,
  results: AnalyzerResult[],
): Promise<void> {
  const metadata = {
    runId,
    createdAt: new Date().toISOString(),
    description: config.description,
    providers: config.providers,
    maxTargets: config.maxTargets,
    promptVersions: [...new Set(results.map((result) => result.promptVersion ?? "unknown"))],
  };

  await writeFile(join(runOutputDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  await writeFile(join(outputDir, "latest-run.txt"), `${runId}\n`);
  await cp(join(runOutputDir, "metadata.json"), join(outputDir, "metadata.json"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
