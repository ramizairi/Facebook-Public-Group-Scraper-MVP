import { pathToFileURL } from "node:url";

import { loadConfig } from "./config/load-config.js";
import { createLogger } from "./output/logger.js";
import { OutputManager } from "./output/manager.js";
import { sanitizeConfigForLog } from "./utils/redact.js";
import { runProxyTest } from "./browser/proxy-test.js";
import { runScraper } from "./core/run-scraper.js";
import { runAnalysisWorkflow } from "./analyze/index.js";
import { runScheduledWorkflow } from "./schedule/run-scheduled.js";

export async function runCliMain(
  argv = process.argv.slice(2),
  cwd = process.cwd(),
) {
  const config = loadConfig(argv, cwd);
  const outputManager = await OutputManager.create(config.outputDir);
  const logger = createLogger(outputManager.paths.logFile);
  logger.info({
    event: "config-loaded",
    config: sanitizeConfigForLog(config),
  });

  if (config.testProxy) {
    await runProxyTest(config, outputManager, logger);
    return;
  }

  if (config.scheduleTotalMinutes != null) {
    const result = await runScheduledWorkflow({
      config,
      logger,
      outputManager,
      runScraper,
      runAnalysis: (scrapeResult) =>
        runAnalysisWorkflow([], config.cwd, {
          posts: scrapeResult?.posts,
        }),
    });

    console.log(
      `scheduled-completed | cycles=${result.cycleCount} | output=${config.outputDir}${result.analysisResult ? ` | xlsx=${result.analysisResult.outputPath}` : ""}`,
    );
    return;
  }

  const result = await runScraper(config, outputManager, logger);
  console.log(`completed | posts=${result.posts.length} | output=${config.outputDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCliMain().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
