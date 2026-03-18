import { loadConfig } from "./config/load-config.js";
import { createLogger } from "./output/logger.js";
import { OutputManager } from "./output/manager.js";
import { sanitizeConfigForLog } from "./utils/redact.js";
import { runProxyTest } from "./browser/proxy-test.js";
import { runScraper } from "./core/run-scraper.js";

async function main() {
  const config = loadConfig();
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

  const result = await runScraper(config, outputManager, logger);
  console.log(`completed | posts=${result.posts.length} | output=${config.outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
