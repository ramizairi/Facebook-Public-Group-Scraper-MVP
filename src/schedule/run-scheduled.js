import { formatDuration, minutesToMs } from "../utils/time.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runScheduledWorkflow({
  config,
  logger,
  outputManager,
  runScraper,
  runAnalysis,
}) {
  const startedAt = Date.now();
  const totalWindowMs = minutesToMs(config.scheduleTotalMinutes);
  const intervalMs = minutesToMs(config.scheduleIntervalMinutes);
  const deadline = startedAt + totalWindowMs;
  let cycle = 0;
  let lastScrapeResult = null;

  logger.info({
    event: "schedule-start",
    totalWindowMs,
    intervalMs,
    scheduleRunAnalyzer: config.scheduleRunAnalyzer,
  });
  console.log(
    `schedule-start | total=${formatDuration(totalWindowMs)} | every=${formatDuration(intervalMs)} | analyzer=${config.scheduleRunAnalyzer ? "on" : "off"}`,
  );

  while (Date.now() < deadline) {
    cycle += 1;
    const cycleStartedAt = Date.now();
    const remainingAtStartMs = Math.max(0, deadline - cycleStartedAt);

    logger.info({
      event: "schedule-cycle-start",
      cycle,
      remainingMs: remainingAtStartMs,
    });
    console.log(
      `schedule-cycle-start | cycle=${cycle} | remaining=${formatDuration(remainingAtStartMs)}`,
    );

    lastScrapeResult = await runScraper(config, outputManager, logger);

    const afterRunMs = Date.now();
    if (afterRunMs >= deadline) {
      break;
    }

    const nextCycleAt = cycleStartedAt + intervalMs;
    const waitMs = Math.max(0, Math.min(deadline - afterRunMs, nextCycleAt - afterRunMs));
    if (waitMs > 0) {
      logger.info({
        event: "schedule-wait",
        cycle,
        waitMs,
      });
      console.log(`schedule-wait | next-in=${formatDuration(waitMs)}`);
      await sleep(waitMs);
    }
  }

  let analysisResult = null;
  if (config.scheduleRunAnalyzer) {
    logger.info({ event: "schedule-analysis-start", cycleCount: cycle });
    analysisResult = await runAnalysis();
    logger.info({
      event: "schedule-analysis-complete",
      outputPath: analysisResult.outputPath,
      rowCount: analysisResult.rows.length,
    });
  }

  logger.info({
    event: "schedule-complete",
    cycleCount: cycle,
    ranAnalyzer: Boolean(analysisResult),
  });

  return {
    cycleCount: cycle,
    lastScrapeResult,
    analysisResult,
  };
}
