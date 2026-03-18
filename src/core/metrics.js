import { elapsedMs, formatDuration, nowIso } from "../utils/time.js";

export class MetricsTracker {
  constructor(initialPostCount = 0) {
    this.startedAtMs = Date.now();
    this.startedAt = nowIso();
    this.retries = 0;
    this.failures = 0;
    this.acceptedBySource = {
      network: 0,
      dom: 0,
    };
    this.seededPosts = initialPostCount;
    this.lastSource = null;
    this.cycles = 0;
  }

  recordAccepted(post) {
    this.acceptedBySource[post.sourceType] += 1;
    this.lastSource = post.sourceType;
  }

  recordRetry() {
    this.retries += 1;
  }

  recordFailure() {
    this.failures += 1;
  }

  recordCycle() {
    this.cycles += 1;
  }

  snapshot({ uniquePosts, networkStats }) {
    const elapsed = elapsedMs(this.startedAtMs);
    const postsPerMinute = elapsed > 0 ? Number(((uniquePosts / elapsed) * 60_000).toFixed(2)) : 0;

    return {
      startedAt: this.startedAt,
      elapsedMs: elapsed,
      elapsedHuman: formatDuration(elapsed),
      uniquePosts,
      postsPerMinute,
      totalRequests: networkStats.totalRequests,
      totalResponses: networkStats.totalResponses,
      relevantResponses: networkStats.relevantResponses,
      requestFailures: networkStats.failedRequests,
      retries: this.retries,
      failures: this.failures,
      sourceBreakdown: this.acceptedBySource,
      lastSource: this.lastSource,
      cycles: this.cycles,
      seededPosts: this.seededPosts,
    };
  }
}
