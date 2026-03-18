import pino from "pino";

export function createLogger(logFile) {
  return pino(
    {
      level: "info",
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination(logFile),
  );
}

export function printProgress(stats) {
  const summary = [
    `elapsed=${stats.elapsedHuman}`,
    `unique=${stats.uniquePosts}`,
    `posts/min=${stats.postsPerMinute}`,
    `requests=${stats.totalRequests}`,
    `failures=${stats.failures}`,
    `retries=${stats.retries}`,
    `source=${stats.lastSource ?? "n/a"}`,
  ];

  console.log(summary.join(" | "));
}
