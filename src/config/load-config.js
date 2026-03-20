import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import { normalizeProxyConfig } from "../browser/proxy-pool.js";
import { normalizeGroupUrl } from "../utils/facebook-url.js";
import { resolveAutoOutputDir } from "../utils/output-dir.js";

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

const ConfigSchema = z
  .object({
    groupUrl: z.string().url().nullable(),
    maxPosts: z.number().int().positive(),
    runtimeMinutes: z.number().positive().nullable(),
    outputDir: z.string().min(1),
    cookiesFile: z.string().min(1).nullable(),
    resume: z.boolean(),
    testProxy: z.boolean(),
    noProxy: z.boolean(),
    headless: z.boolean(),
    scheduleTotalMinutes: z.number().positive().nullable(),
    scheduleIntervalMinutes: z.number().positive(),
    scheduleRunAnalyzer: z.boolean(),
    sessionStateEnabled: z.boolean(),
    sessionStateDir: z.string().min(1).nullable(),
    sessionStateTtlHours: z.number().positive(),
    sessionStateMinPostsToSave: z.number().int().nonnegative(),
    sessionStateResetOnBlock: z.boolean(),
    startupRetries: z.number().int().nonnegative(),
    startupSettleMs: z.number().int().nonnegative(),
    homeWarmup: z.boolean(),
    homeWarmupDelayMs: z.number().int().nonnegative(),
    minDelayMs: z.number().int().nonnegative(),
    maxDelayMs: z.number().int().nonnegative(),
    noNewPostCycles: z.number().int().positive(),
    networkStallRecycleCycles: z.number().int().positive(),
    maxNetworkStallRestarts: z.number().int().nonnegative(),
    browserRecycleRequests: z.number().int().positive(),
    browserLocale: z.string().min(2),
    browserTimezone: z.string().min(1).nullable(),
    userAgent: z.string().min(1),
    proxyPoolDir: z.string().min(1).nullable(),
    proxyPoolProtocol: z.string().min(3),
    proxyMaxSessionsPerProxy: z.number().int().positive(),
    proxyQuarantineMinutes: z.number().positive(),
    proxyFailureScoreThreshold: z.number().int().positive(),
    proxyLowYieldPostThreshold: z.number().int().positive(),
    proxyRotateOnRetry: z.boolean(),
    proxyRotateOnRecycle: z.boolean(),
    proxyRotateOnBlock: z.boolean(),
    proxyTestUrl: z.string().url(),
    navigationTimeoutMs: z.number().int().positive(),
    proxy: z
      .object({
        server: z.string().min(1),
        username: z.string().min(1).optional(),
        password: z.string().min(1).optional(),
      })
      .nullable(),
  })
  .superRefine((value, ctx) => {
    if (!value.testProxy && !value.groupUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide GROUP_URL in .env or pass --url for scraping runs.",
        path: ["groupUrl"],
      });
    }

    if (value.maxDelayMs < value.minDelayMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maxDelayMs must be greater than or equal to minDelayMs.",
        path: ["maxDelayMs"],
      });
    }

    if (value.scheduleTotalMinutes != null && value.scheduleIntervalMinutes <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scheduleIntervalMinutes must be positive when scheduleTotalMinutes is set.",
        path: ["scheduleIntervalMinutes"],
      });
    }
  });

export function loadConfig(
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  envOverrides = {},
) {
  loadDotEnv({ path: path.join(cwd, ".env"), override: false, quiet: true });

  const cli = parseArgs(argv);
  const env = {
    ...process.env,
    ...envOverrides,
  };

  const rawGroupUrl = pickFirstNonEmpty(cli.url, env.GROUP_URL);
  const groupUrl = rawGroupUrl ? normalizeGroupUrl(rawGroupUrl) : null;
  const resume = parseBoolean(cli.resume, true);
  const noProxy = parseBoolean(cli["no-proxy"], false);
  const rawOutputDir = pickFirstNonEmpty(cli["output-dir"]) ?? resolveAutoOutputDir(cwd, { resume });
  const proxyServer = noProxy ? "" : (pickFirstNonEmpty(cli["proxy-server"], env.PROXY_SERVER) ?? "");
  const proxyUsername = noProxy ? "" : (pickFirstNonEmpty(cli["proxy-username"], env.PROXY_USERNAME) ?? "");
  const proxyPassword = noProxy ? "" : (pickFirstNonEmpty(cli["proxy-password"], env.PROXY_PASSWORD) ?? "");
  const proxyPoolDir = noProxy ? null : pickFirstNonEmpty(cli["proxy-pool-dir"], env.PROXY_POOL_DIR);
  const normalizedStaticProxy = proxyServer
    ? normalizeProxyConfig(
        {
          server: proxyServer,
          username: proxyUsername || undefined,
          password: proxyPassword || undefined,
        },
        "http",
      )
    : null;

  const config = ConfigSchema.parse({
    groupUrl,
    maxPosts: parseNumber(cli["max-posts"] ?? env.MAX_POSTS, 100),
    runtimeMinutes: parseNumber(cli["runtime-minutes"] ?? env.RUNTIME_MINUTES, null),
    outputDir: path.resolve(cwd, rawOutputDir),
    cookiesFile: pickFirstNonEmpty(cli["cookies-file"], env.COOKIES_FILE)
      ? path.resolve(cwd, pickFirstNonEmpty(cli["cookies-file"], env.COOKIES_FILE))
      : null,
    resume,
    testProxy: parseBoolean(cli["test-proxy"], false),
    noProxy,
    headless: parseBoolean(cli.headless ?? env.HEADLESS, true),
    scheduleTotalMinutes: parseNumber(
      cli["schedule-total-minutes"] ?? env.SCHEDULE_TOTAL_MINUTES,
      null,
    ),
    scheduleIntervalMinutes: parseNumber(
      cli["schedule-interval-minutes"] ?? env.SCHEDULE_INTERVAL_MINUTES,
      15,
    ),
    scheduleRunAnalyzer: parseBoolean(
      cli["schedule-run-analyzer"] ?? env.SCHEDULE_RUN_ANALYZER,
      true,
    ),
    sessionStateEnabled: parseBoolean(
      cli["session-state-enabled"] ?? env.SESSION_STATE_ENABLED,
      true,
    ),
    sessionStateDir: path.resolve(
      cwd,
      pickFirstNonEmpty(cli["session-state-dir"], env.SESSION_STATE_DIR, path.join(rawOutputDir, "session-state")),
    ),
    sessionStateTtlHours: parseNumber(
      cli["session-state-ttl-hours"] ?? env.SESSION_STATE_TTL_HOURS,
      72,
    ),
    sessionStateMinPostsToSave: parseNumber(
      cli["session-state-min-posts-to-save"] ?? env.SESSION_STATE_MIN_POSTS_TO_SAVE,
      1,
    ),
    sessionStateResetOnBlock: parseBoolean(
      cli["session-state-reset-on-block"] ?? env.SESSION_STATE_RESET_ON_BLOCK,
      true,
    ),
    startupRetries: parseNumber(cli["startup-retries"] ?? env.STARTUP_RETRIES, 2),
    startupSettleMs: parseNumber(cli["startup-settle-ms"] ?? env.STARTUP_SETTLE_MS, 1_500),
    homeWarmup: parseBoolean(cli["home-warmup"] ?? env.HOME_WARMUP, true),
    homeWarmupDelayMs: parseNumber(cli["home-warmup-delay-ms"] ?? env.HOME_WARMUP_DELAY_MS, 300),
    minDelayMs: parseNumber(cli["min-delay-ms"] ?? env.MIN_DELAY_MS, 1_200),
    maxDelayMs: parseNumber(cli["max-delay-ms"] ?? env.MAX_DELAY_MS, 2_800),
    noNewPostCycles: parseNumber(cli["no-new-post-cycles"] ?? env.NO_NEW_POST_CYCLES, 4),
    networkStallRecycleCycles: parseNumber(
      cli["network-stall-recycle-cycles"] ?? env.NETWORK_STALL_RECYCLE_CYCLES,
      2,
    ),
    maxNetworkStallRestarts: parseNumber(
      cli["max-network-stall-restarts"] ?? env.MAX_NETWORK_STALL_RESTARTS,
      2,
    ),
    browserRecycleRequests: parseNumber(
      cli["browser-recycle-requests"] ?? env.BROWSER_RECYCLE_REQUESTS,
      250,
    ),
    browserLocale: pickFirstNonEmpty(cli["browser-locale"], env.BROWSER_LOCALE, "en-US"),
    browserTimezone: pickFirstNonEmpty(cli["browser-timezone"], env.BROWSER_TIMEZONE),
    userAgent:
      pickFirstNonEmpty(
        cli["user-agent"],
        env.USER_AGENT,
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      ),
    proxyPoolDir: proxyPoolDir ? path.resolve(cwd, proxyPoolDir) : null,
    proxyPoolProtocol: pickFirstNonEmpty(cli["proxy-pool-protocol"], env.PROXY_POOL_PROTOCOL, "socks5"),
    proxyMaxSessionsPerProxy: parseNumber(
      cli["proxy-max-sessions-per-proxy"] ?? env.PROXY_MAX_SESSIONS_PER_PROXY,
      1,
    ),
    proxyQuarantineMinutes: parseNumber(
      cli["proxy-quarantine-minutes"] ?? env.PROXY_QUARANTINE_MINUTES,
      30,
    ),
    proxyFailureScoreThreshold: parseNumber(
      cli["proxy-failure-score-threshold"] ?? env.PROXY_FAILURE_SCORE_THRESHOLD,
      3,
    ),
    proxyLowYieldPostThreshold: parseNumber(
      cli["proxy-low-yield-post-threshold"] ?? env.PROXY_LOW_YIELD_POST_THRESHOLD,
      3,
    ),
    proxyRotateOnRetry: parseBoolean(cli["proxy-rotate-on-retry"] ?? env.PROXY_ROTATE_ON_RETRY, true),
    proxyRotateOnRecycle: parseBoolean(
      cli["proxy-rotate-on-recycle"] ?? env.PROXY_ROTATE_ON_RECYCLE,
      true,
    ),
    proxyRotateOnBlock: parseBoolean(cli["proxy-rotate-on-block"] ?? env.PROXY_ROTATE_ON_BLOCK, true),
    proxyTestUrl: pickFirstNonEmpty(
      cli["proxy-test-url"],
      env.PROXY_TEST_URL,
      "https://api.ipify.org?format=json",
    ),
    navigationTimeoutMs: parseNumber(cli["navigation-timeout-ms"] ?? env.NAVIGATION_TIMEOUT_MS, 45_000),
    proxy: normalizedStaticProxy,
  });

  return {
    ...config,
    cwd,
  };
}
