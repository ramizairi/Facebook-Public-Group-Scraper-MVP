import fs from "node:fs/promises";
import path from "node:path";

import { redactProxyConfig } from "../utils/redact.js";

const DEFAULT_PROXY_QUARANTINE_MINUTES = 30;
const DEFAULT_PROXY_FAILURE_SCORE_THRESHOLD = 3;
const DEFAULT_PROXY_LOW_YIELD_POST_THRESHOLD = 3;
const PROXY_POOL_CACHE = new Map();

function buildProxyKey(proxy) {
  return `${proxy.server}|${proxy.username ?? ""}|${proxy.password ?? ""}`;
}

export function parseProxyLine(line, defaultProtocol = "socks5") {
  const normalized = String(line ?? "").trim();
  if (!normalized || normalized.startsWith("#")) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      return {
        server: `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ""}`,
        username: parsedUrl.username || undefined,
        password: parsedUrl.password || undefined,
      };
    } catch {
      return null;
    }
  }

  const csvParts = normalized.split(",").map((part) => part.trim());
  if (csvParts.length >= 2) {
    const [host, port, username, ...passwordParts] = csvParts;
    if (host && port) {
      return {
        server: `${defaultProtocol}://${host}:${port}`,
        username: username || undefined,
        password: passwordParts.join(",").trim() || undefined,
      };
    }
  }

  const authAtMatch = normalized.match(/^([^:@/\s]+):([^@/\s]*)@([^:/\s]+):(\d+)$/);
  if (authAtMatch) {
    const [, username, password, host, port] = authAtMatch;
    return {
      server: `${defaultProtocol}://${host}:${port}`,
      username: username || undefined,
      password: password || undefined,
    };
  }

  const parts = normalized.split(":");
  if (parts.length < 2) {
    return null;
  }

  const [host, port, username, ...passwordParts] = parts;
  const trimmedHost = host?.trim();
  const trimmedPort = port?.trim();

  if (!trimmedHost || !trimmedPort) {
    return null;
  }

  return {
    server: `${defaultProtocol}://${trimmedHost}:${trimmedPort}`,
    username: username?.trim() || undefined,
    password: passwordParts.join(":").trim() || undefined,
  };
}

export function normalizeProxyConfig(proxy, defaultProtocol = "http") {
  if (!proxy?.server) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(proxy.server)) {
    return {
      server: proxy.server,
      username: proxy.username || undefined,
      password: proxy.password || undefined,
    };
  }

  const normalized = parseProxyLine(
    [proxy.server, proxy.username || "", proxy.password || ""]
      .filter((part, index) => index < 2 || part)
      .join(":"),
    defaultProtocol,
  );

  return (
    normalized ?? {
      server: proxy.server,
      username: proxy.username || undefined,
      password: proxy.password || undefined,
    }
  );
}

async function readProxyFiles(proxyPoolDir, defaultProtocol) {
  const entries = await fs.readdir(proxyPoolDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const proxies = [];
  for (const fileName of files) {
    const filePath = path.join(proxyPoolDir, fileName);
    const raw = await fs.readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const proxy = parseProxyLine(line, defaultProtocol);
      if (proxy) {
        proxies.push(proxy);
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const proxy of proxies) {
    const key = buildProxyKey(proxy);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(proxy);
  }

  return deduped;
}

export class ProxyPool {
  constructor(proxies, options, logger) {
    this.proxies = proxies;
    this.logger = logger;
    this.records = proxies.map((proxy) => ({
      proxy,
      key: buildProxyKey(proxy),
      score: 0,
      successes: 0,
      failures: 0,
      loginWalls: 0,
      lowYields: 0,
      proxyErrors: 0,
      totalPosts: 0,
      quarantinedUntil: 0,
      lastOutcome: null,
    }));
    this.currentIndex = -1;
    this.sessionsOnCurrentProxy = 0;
    this.updateSettings(options, logger);
  }

  static async create(config, logger) {
    if (!config.proxyPoolDir) {
      return null;
    }

    try {
      const proxies = await readProxyFiles(config.proxyPoolDir, config.proxyPoolProtocol);
      if (!proxies.length) {
        logger.warn({
          event: "proxy-pool-empty",
          proxyPoolDir: config.proxyPoolDir,
        });
        return null;
      }

      const cacheKey = `${config.proxyPoolDir}|${config.proxyPoolProtocol}`;
      const cached = PROXY_POOL_CACHE.get(cacheKey);
      const sameProxySet =
        cached &&
        cached.proxies.length === proxies.length &&
        cached.proxies.every((proxy, index) => buildProxyKey(proxy) === buildProxyKey(proxies[index]));

      if (sameProxySet) {
        cached.logger = logger;
        cached.updateSettings(
          {
            maxSessionsPerProxy: config.proxyMaxSessionsPerProxy,
            quarantineMinutes: config.proxyQuarantineMinutes,
            failureScoreThreshold: config.proxyFailureScoreThreshold,
            lowYieldPostThreshold: config.proxyLowYieldPostThreshold,
          },
          logger,
        );

        logger.info({
          event: "proxy-pool-loaded",
          proxyPoolDir: config.proxyPoolDir,
          proxyPoolProtocol: config.proxyPoolProtocol,
          proxyCount: proxies.length,
          maxSessionsPerProxy: config.proxyMaxSessionsPerProxy,
          reusedState: true,
        });
        return cached;
      }

      logger.info({
        event: "proxy-pool-loaded",
        proxyPoolDir: config.proxyPoolDir,
        proxyPoolProtocol: config.proxyPoolProtocol,
        proxyCount: proxies.length,
        maxSessionsPerProxy: config.proxyMaxSessionsPerProxy,
        reusedState: false,
      });

      const pool = new ProxyPool(
        proxies,
        {
          maxSessionsPerProxy: config.proxyMaxSessionsPerProxy,
          quarantineMinutes: config.proxyQuarantineMinutes,
          failureScoreThreshold: config.proxyFailureScoreThreshold,
          lowYieldPostThreshold: config.proxyLowYieldPostThreshold,
        },
        logger,
      );
      PROXY_POOL_CACHE.set(cacheKey, pool);
      return pool;
    } catch (error) {
      logger.warn({
        event: "proxy-pool-load-failed",
        proxyPoolDir: config.proxyPoolDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  hasProxies() {
    return this.proxies.length > 0;
  }

  updateSettings(options, logger = this.logger) {
    this.logger = logger;
    this.maxSessionsPerProxy = Math.max(1, options.maxSessionsPerProxy ?? 1);
    this.quarantineMs = Math.max(
      1,
      Number(options.quarantineMinutes ?? DEFAULT_PROXY_QUARANTINE_MINUTES) * 60 * 1000,
    );
    this.failureScoreThreshold = Math.max(
      1,
      Number(options.failureScoreThreshold ?? DEFAULT_PROXY_FAILURE_SCORE_THRESHOLD),
    );
    this.lowYieldPostThreshold = Math.max(
      1,
      Number(options.lowYieldPostThreshold ?? DEFAULT_PROXY_LOW_YIELD_POST_THRESHOLD),
    );
  }

  isQuarantined(record, now = Date.now()) {
    return record.quarantinedUntil > now;
  }

  chooseNextIndex({ forceRotate = false } = {}) {
    const now = Date.now();
    const candidateRecords = this.records.filter((record, index) => {
      if (this.isQuarantined(record, now)) {
        return false;
      }

      if (forceRotate && this.records.length > 1 && index === this.currentIndex) {
        return false;
      }

      return true;
    });

    if (!candidateRecords.length) {
      const fallback = [...this.records].sort((left, right) => {
        if (left.quarantinedUntil !== right.quarantinedUntil) {
          return left.quarantinedUntil - right.quarantinedUntil;
        }

        return left.score - right.score;
      })[0];

      this.logger.warn({
        event: "proxy-pool-all-quarantined",
        proxyCount: this.records.length,
        nextAvailableAt: fallback?.quarantinedUntil ?? null,
      });
      return this.records.indexOf(fallback);
    }

    const bestScore = Math.min(...candidateRecords.map((record) => record.score));
    const bestIndices = candidateRecords
      .map((record) => this.records.indexOf(record))
      .filter((index) => index >= 0 && this.records[index].score === bestScore);

    const sorted = bestIndices.sort((left, right) => {
      const leftDistance =
        this.currentIndex === -1
          ? left
          : (left - this.currentIndex + this.records.length) % this.records.length;
      const rightDistance =
        this.currentIndex === -1
          ? right
          : (right - this.currentIndex + this.records.length) % this.records.length;

      return leftDistance - rightDistance;
    });

    return sorted[0] ?? 0;
  }

  acquire({ reason = "session-start", forceRotate = false } = {}) {
    if (!this.proxies.length) {
      return null;
    }

    const currentRecord = this.records[this.currentIndex];
    if (
      this.currentIndex === -1 ||
      forceRotate ||
      this.sessionsOnCurrentProxy >= this.maxSessionsPerProxy ||
      (currentRecord && this.isQuarantined(currentRecord))
    ) {
      this.currentIndex = this.chooseNextIndex({ forceRotate });
      this.sessionsOnCurrentProxy = 0;
    }

    this.sessionsOnCurrentProxy += 1;
    const record = this.records[this.currentIndex];
    const proxy = {
      ...record.proxy,
      _poolKey: record.key,
      _selection: {
        mode: "pool",
        index: this.currentIndex + 1,
        count: this.proxies.length,
        reason,
        sessionCountOnProxy: this.sessionsOnCurrentProxy,
        score: record.score,
      },
    };

    this.logger.info({
      event: "proxy-selected",
      reason,
      proxyIndex: this.currentIndex + 1,
      proxyCount: this.proxies.length,
      sessionCountOnProxy: this.sessionsOnCurrentProxy,
      proxyScore: record.score,
      proxy: redactProxyConfig(proxy),
    });

    return proxy;
  }

  findRecord(proxy) {
    if (!proxy) {
      return null;
    }

    const key = proxy._poolKey ?? buildProxyKey(proxy);
    return this.records.find((record) => record.key === key) ?? null;
  }

  reportSuccess(proxy, details = {}) {
    const record = this.findRecord(proxy);
    if (!record) {
      return;
    }

    const posts = Math.max(0, Number(details.posts ?? 0));
    record.successes += 1;
    record.totalPosts += posts;
    record.lastOutcome = details.reason ?? "success";
    record.score = Math.max(0, record.score - (posts >= this.lowYieldPostThreshold ? 2 : 1));
    if (record.score === 0) {
      record.quarantinedUntil = 0;
    }

    this.logger.info({
      event: "proxy-feedback",
      outcome: "success",
      reason: details.reason ?? "success",
      posts,
      score: record.score,
      proxy: redactProxyConfig(record.proxy),
    });
  }

  reportFailure(proxy, details = {}) {
    const record = this.findRecord(proxy);
    if (!record) {
      return;
    }

    const reason = details.reason ?? "failure";
    const posts = Math.max(0, Number(details.posts ?? 0));
    let penalty = 1;

    if (reason === "proxy-error") {
      penalty = 4;
      record.proxyErrors += 1;
    } else if (reason === "login-wall" || reason === "redirected-to-login" || reason === "blocked") {
      penalty = 3;
      record.loginWalls += 1;
    } else if (reason === "low-yield") {
      penalty = 2;
      record.lowYields += 1;
    }

    record.failures += 1;
    record.totalPosts += posts;
    record.lastOutcome = reason;
    record.score += penalty;

    let quarantinedUntil = record.quarantinedUntil;
    if (reason === "proxy-error" || record.score >= this.failureScoreThreshold) {
      quarantinedUntil = Date.now() + this.quarantineMs;
      record.quarantinedUntil = quarantinedUntil;
    }

    this.logger.info({
      event: "proxy-feedback",
      outcome: "failure",
      reason,
      posts,
      score: record.score,
      quarantinedUntil: quarantinedUntil || null,
      proxy: redactProxyConfig(record.proxy),
    });
  }

  getStateSnapshot() {
    return this.records.map((record, index) => ({
      index: index + 1,
      proxy: redactProxyConfig(record.proxy),
      score: record.score,
      successes: record.successes,
      failures: record.failures,
      loginWalls: record.loginWalls,
      lowYields: record.lowYields,
      proxyErrors: record.proxyErrors,
      totalPosts: record.totalPosts,
      quarantinedUntil: record.quarantinedUntil || null,
      lastOutcome: record.lastOutcome,
    }));
  }
}
