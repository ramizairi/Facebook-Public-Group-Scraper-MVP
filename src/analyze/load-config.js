import fs from "node:fs";
import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import { resolveLatestResultDir } from "../utils/output-dir.js";
import { normalizeGroupUrl } from "../utils/facebook-url.js";

const BOOLEAN_TRUE = new Set(["1", "true", "yes", "on"]);
const BOOLEAN_FALSE = new Set(["0", "false", "no", "off"]);

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }

      continue;
    }

    if (value != null) {
      return value;
    }
  }

  return null;
}

function parseBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string" || !value.length) {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (BOOLEAN_TRUE.has(normalized)) {
    return true;
  }

  if (BOOLEAN_FALSE.has(normalized)) {
    return false;
  }

  return fallback;
}

function parseNumber(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }

    const body = current.slice(2);
    if (!body) {
      continue;
    }

    const equalIndex = body.indexOf("=");
    if (equalIndex !== -1) {
      parsed[body.slice(0, equalIndex)] = body.slice(equalIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[body] = true;
      continue;
    }

    parsed[body] = next;
    index += 1;
  }

  return parsed;
}

const AnalysisConfigSchema = z.object({
  geminiApiKey: z.string().min(1),
  geminiModel: z.string().min(1),
  geminiBatchSize: z.number().int().positive(),
  geminiTemperature: z.number().min(0).max(2),
  geminiMaxOutputTokens: z.number().int().positive(),
  inputDir: z.string().min(1),
  inputPostsFile: z.string().min(1),
  useUnfilteredPosts: z.boolean(),
  maxPostsToAnalyze: z.number().int().positive().nullable(),
  outputDir: z.string().min(1),
  outputFile: z.string().min(1),
  cwd: z.string().min(1),
});

export function loadAnalysisConfig(
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  options = {},
) {
  loadDotEnv({ path: path.join(cwd, ".env"), override: false, quiet: true });
  const cli = parseArgs(argv);
  const env = {
    ...process.env,
    ...(options.envOverrides ?? {}),
  };

  const analysisGroupUrl = normalizeGroupUrl(
    pickFirstNonEmpty(cli["group-url"], cli.url, env.GROUP_URL),
  );
  const latestResultDir = resolveLatestResultDir(cwd, { groupUrl: analysisGroupUrl });
  const rawInputDir = pickFirstNonEmpty(cli["input-dir"], env.ANALYZER_INPUT_DIR, latestResultDir);
  const rawGeminiApiKey = pickFirstNonEmpty(cli["gemini-api-key"], env.GEMINI_API_KEY);
  const useUnfilteredPosts = parseBoolean(
    cli["use-unfiltered-posts"] ?? env.ANALYZER_USE_UNFILTERED_POSTS,
    false,
  );
  const configuredInputFile = pickFirstNonEmpty(cli["input-file"], env.ANALYZER_INPUT_FILE);
  const inputPostsFile = configuredInputFile
    ? path.resolve(cwd, configuredInputFile)
    : path.join(path.resolve(cwd, rawInputDir ?? ""), "output.json");

  if (!rawGeminiApiKey) {
    throw new Error("Set GEMINI_API_KEY in .env before running npm run analyze:xlsx.");
  }

  const config = AnalysisConfigSchema.parse({
    geminiApiKey: rawGeminiApiKey,
    geminiModel: pickFirstNonEmpty(cli["gemini-model"], env.GEMINI_MODEL, "gemini-2.5-flash"),
    geminiBatchSize: parseNumber(cli["gemini-batch-size"] ?? env.GEMINI_BATCH_SIZE, 8),
    geminiTemperature: parseNumber(cli["gemini-temperature"] ?? env.GEMINI_TEMPERATURE, 0.2),
    geminiMaxOutputTokens: parseNumber(
      cli["gemini-max-output-tokens"] ?? env.GEMINI_MAX_OUTPUT_TOKENS,
      8192,
    ),
    inputDir: path.resolve(cwd, rawInputDir ?? ""),
    inputPostsFile,
    useUnfilteredPosts,
    maxPostsToAnalyze: parseNumber(cli["max-posts-to-analyze"] ?? env.MAX_POSTS_TO_ANALYZE, null),
    outputDir: path.resolve(cwd, pickFirstNonEmpty(cli["analyzer-output-dir"], env.ANALYZER_OUTPUT_DIR, rawInputDir)),
    outputFile: pickFirstNonEmpty(cli["analyzer-output-file"], env.ANALYZER_OUTPUT_FILE, "output.xlsx"),
    cwd,
  });

  if (options.requireInputFile !== false && !fs.existsSync(config.inputPostsFile)) {
    throw new Error(`Analyzer input file not found: ${config.inputPostsFile}`);
  }

  return config;
}
