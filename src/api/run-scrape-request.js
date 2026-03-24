import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { loadConfig } from "../config/load-config.js";
import { runScraper } from "../core/run-scraper.js";
import { OutputManager } from "../output/manager.js";
import { createLogger } from "../output/logger.js";
import { deriveOutputSlug } from "../utils/facebook-url.js";

const ApiScrapeRequestSchema = z.object({
  groupUrl: z.string().url("groupUrl must be a valid URL."),
  maxPosts: z.coerce.number().int().positive("maxPosts must be a positive integer.").max(1_000),
});

function buildRequestStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function parseApiScrapeRequest(payload) {
  return ApiScrapeRequestSchema.parse(payload ?? {});
}

export function resolveApiOutputDir(cwd, groupUrl) {
  return path.join(cwd, "output", "api", `${deriveOutputSlug(groupUrl)}-${buildRequestStamp()}`);
}

export async function runApiScrapeRequest(
  payload,
  {
    cwd = process.cwd(),
    runScraperImpl = runScraper,
    outputManagerClass = OutputManager,
    createLoggerImpl = createLogger,
  } = {},
) {
  const request = parseApiScrapeRequest(payload);
  const outputDir = resolveApiOutputDir(cwd, request.groupUrl);
  const config = loadConfig(
    [
      "--url",
      request.groupUrl,
      "--max-posts",
      String(request.maxPosts),
      "--output-dir",
      outputDir,
      "--no-proxy",
      "--resume",
      "false",
    ],
    cwd,
    {
      COOKIES_FILE: "",
      HEADLESS: "true",
    },
  );
  const outputManager = await outputManagerClass.create(config.outputDir);
  const logger = createLoggerImpl(outputManager.paths.logFile);

  logger.info({
    event: "api-scrape-requested",
    groupUrl: config.groupUrl,
    maxPosts: config.maxPosts,
    outputDir: config.outputDir,
    noProxy: config.noProxy,
  });

  const result = await runScraperImpl(config, outputManager, logger);
  const outputBuffer = await fs.readFile(outputManager.paths.outputJson);

  return {
    outputBuffer,
    outputDir: config.outputDir,
    outputFileName: "output.json",
    postsCount: result.posts.length,
    groupUrl: config.groupUrl,
  };
}
