import path from "node:path";
import fs from "node:fs/promises";

import { Actor } from "apify";

import { runAnalysisWorkflow } from "../analyze/index.js";
import { runProxyTest } from "../browser/proxy-test.js";
import { loadConfig } from "../config/load-config.js";
import { runScraper } from "../core/run-scraper.js";
import { createLogger } from "../output/logger.js";
import { runScheduledWorkflow } from "../schedule/run-scheduled.js";
import { sanitizeConfigForLog } from "../utils/redact.js";
import {
  buildApifyProxyOptions,
  buildConfigEnvOverrides,
  parseActorInput,
  summarizeApifyProxyOptions,
} from "./input.js";
import { ApifyOutputManager } from "./output-manager.js";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function storeAnalysisArtifacts(analysisResult) {
  if (!analysisResult) {
    return;
  }

  await Actor.setValue("analysis.rows.json", analysisResult.rows);
  const workbookBuffer = await fs.readFile(analysisResult.outputPath);
  await Actor.setValue("output.xlsx", workbookBuffer, {
    contentType: XLSX_CONTENT_TYPE,
  });
}

function isUnavailableCountryProxyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /no usable proxies from country/i.test(message);
}

async function createActorProxyConfiguration(input, logger) {
  const proxyOptions = buildApifyProxyOptions(input);
  if (!proxyOptions) {
    return {
      proxyConfiguration: null,
      proxyOptions: null,
    };
  }

  try {
    const proxyConfiguration = await Actor.createProxyConfiguration(proxyOptions);
    return {
      proxyConfiguration,
      proxyOptions,
    };
  } catch (error) {
    if (proxyOptions.countryCode && isUnavailableCountryProxyError(error)) {
      logger.warn({
        event: "apify-proxy-country-fallback",
        requestedCountryCode: proxyOptions.countryCode,
        groups: proxyOptions.groups ?? [],
        message: error instanceof Error ? error.message : String(error),
      });

      const { countryCode, ...fallbackOptions } = proxyOptions;
      const proxyConfiguration = await Actor.createProxyConfiguration(fallbackOptions);
      return {
        proxyConfiguration,
        proxyOptions: fallbackOptions,
      };
    }

    throw error;
  }
}

export async function runApifyMain(cwd = process.cwd()) {
  await Actor.main(async () => {
    const rawInput = (await Actor.getInput()) ?? {};
    const input = parseActorInput(rawInput);
    const envOverrides = buildConfigEnvOverrides(input);
    const config = loadConfig([], cwd, envOverrides);
    const actorWorkDir = path.resolve(
      process.env.APIFY_LOCAL_STORAGE_DIR ?? path.join(cwd, "apify_storage"),
      "..",
      "actor-work",
    );
    config.outputDir = path.join(actorWorkDir, "result");
    config.sessionStateDir = path.join(config.outputDir, "session-state");
    const outputManager = await ApifyOutputManager.create();
    const logger = createLogger(outputManager.paths.logFile);
    const { proxyConfiguration, proxyOptions } = await createActorProxyConfiguration(input, logger);

    if (!input.noProxy && proxyConfiguration) {
      Object.defineProperty(config, "apifyProxyConfiguration", {
        value: proxyConfiguration,
        enumerable: false,
        configurable: true,
      });
      config.apifyProxySummary = summarizeApifyProxyOptions(proxyOptions);
    }

    config.noProxy = input.noProxy ?? false;
    logger.info({
      event: "config-loaded",
      config: sanitizeConfigForLog(config),
      actorInput: {
        groupUrl: input.groupUrl,
        runAnalyzerAtEnd: input.runAnalyzerAtEnd ?? false,
      },
    });

    if (config.testProxy) {
      await runProxyTest(config, outputManager, logger);
      return;
    }

    let scrapeResult;
    let analysisResult = null;

    if (config.scheduleTotalMinutes != null) {
      const scheduled = await runScheduledWorkflow({
        config,
        logger,
        outputManager,
        runScraper,
        runAnalysis: (lastScrapeResult) =>
          runAnalysisWorkflow([], config.cwd, {
            posts: lastScrapeResult?.posts,
            envOverrides: {
              ...envOverrides,
              ANALYZER_OUTPUT_DIR: path.join(actorWorkDir, "xlsx"),
            },
          }),
      });
      scrapeResult = scheduled.lastScrapeResult;
      analysisResult = scheduled.analysisResult;
    } else {
      scrapeResult = await runScraper(config, outputManager, logger);
      if (input.runAnalyzerAtEnd) {
        analysisResult = await runAnalysisWorkflow([], config.cwd, {
          posts: scrapeResult?.posts,
          envOverrides: {
            ...envOverrides,
            ANALYZER_OUTPUT_DIR: path.join(actorWorkDir, "xlsx"),
          },
        });
      }
    }

    await storeAnalysisArtifacts(analysisResult);
    await Actor.setValue("OUTPUT", {
      groupUrl: config.groupUrl,
      postCount: scrapeResult?.posts?.length ?? 0,
      stats: scrapeResult?.stats ?? null,
      analysis: analysisResult
        ? {
            rowCount: analysisResult.rows.length,
            outputKey: "output.xlsx",
          }
        : null,
    });

    console.log(
      `actor-completed | posts=${scrapeResult?.posts?.length ?? 0}${analysisResult ? ` | xlsx=output.xlsx` : ""}`,
    );
  });
}
