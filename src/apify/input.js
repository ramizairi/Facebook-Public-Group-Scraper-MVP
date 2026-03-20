import { z } from "zod";

const ProxyConfigurationSchema = z
  .object({
    useApifyProxy: z.boolean().optional(),
    apifyProxyGroups: z.array(z.string().min(1)).optional(),
    proxyUrls: z.array(z.string().min(1)).optional(),
  })
  .passthrough()
  .optional();

const ActorInputSchema = z.object({
  groupUrl: z.string().url(),
  maxPosts: z.number().int().positive().optional(),
  runtimeMinutes: z.number().positive().optional().nullable(),
  headless: z.boolean().optional(),
  noProxy: z.boolean().optional(),
  proxyConfiguration: ProxyConfigurationSchema,
  proxyCountryCode: z.string().length(2).optional().nullable(),
  startupRetries: z.number().int().nonnegative().optional(),
  startupSettleMs: z.number().int().nonnegative().optional(),
  homeWarmup: z.boolean().optional(),
  homeWarmupDelayMs: z.number().int().nonnegative().optional(),
  minDelayMs: z.number().int().nonnegative().optional(),
  maxDelayMs: z.number().int().nonnegative().optional(),
  noNewPostCycles: z.number().int().positive().optional(),
  networkStallRecycleCycles: z.number().int().positive().optional(),
  maxNetworkStallRestarts: z.number().int().nonnegative().optional(),
  browserRecycleRequests: z.number().int().positive().optional(),
  browserLocale: z.string().min(2).optional(),
  browserTimezone: z.string().min(1).optional().nullable(),
  userAgent: z.string().min(1).optional(),
  navigationTimeoutMs: z.number().int().positive().optional(),
  sessionStateEnabled: z.boolean().optional(),
  sessionStateTtlHours: z.number().positive().optional(),
  sessionStateMinPostsToSave: z.number().int().nonnegative().optional(),
  sessionStateResetOnBlock: z.boolean().optional(),
  scheduleTotalMinutes: z.number().positive().optional().nullable(),
  scheduleIntervalMinutes: z.number().positive().optional(),
  scheduleRunAnalyzer: z.boolean().optional(),
  runAnalyzerAtEnd: z.boolean().optional(),
  analyzerUseUnfilteredPosts: z.boolean().optional(),
  maxPostsToAnalyze: z.number().int().positive().optional().nullable(),
  geminiModel: z.string().min(1).optional(),
  geminiBatchSize: z.number().int().positive().optional(),
  geminiTemperature: z.number().min(0).max(2).optional(),
  geminiMaxOutputTokens: z.number().int().positive().optional(),
});

function toEnvValue(value) {
  if (value == null) {
    return "";
  }

  return String(value);
}

export function parseActorInput(input = {}) {
  return ActorInputSchema.parse(input ?? {});
}

export function buildConfigEnvOverrides(input) {
  return {
    GROUP_URL: input.groupUrl,
    MAX_POSTS: toEnvValue(input.maxPosts),
    RUNTIME_MINUTES: toEnvValue(input.runtimeMinutes),
    HEADLESS: toEnvValue(input.headless),
    STARTUP_RETRIES: toEnvValue(input.startupRetries),
    STARTUP_SETTLE_MS: toEnvValue(input.startupSettleMs),
    HOME_WARMUP: toEnvValue(input.homeWarmup),
    HOME_WARMUP_DELAY_MS: toEnvValue(input.homeWarmupDelayMs),
    MIN_DELAY_MS: toEnvValue(input.minDelayMs),
    MAX_DELAY_MS: toEnvValue(input.maxDelayMs),
    NO_NEW_POST_CYCLES: toEnvValue(input.noNewPostCycles),
    NETWORK_STALL_RECYCLE_CYCLES: toEnvValue(input.networkStallRecycleCycles),
    MAX_NETWORK_STALL_RESTARTS: toEnvValue(input.maxNetworkStallRestarts),
    BROWSER_RECYCLE_REQUESTS: toEnvValue(input.browserRecycleRequests),
    BROWSER_LOCALE: toEnvValue(input.browserLocale),
    BROWSER_TIMEZONE: toEnvValue(input.browserTimezone),
    USER_AGENT: toEnvValue(input.userAgent),
    NAVIGATION_TIMEOUT_MS: toEnvValue(input.navigationTimeoutMs),
    SESSION_STATE_ENABLED: toEnvValue(input.sessionStateEnabled),
    SESSION_STATE_TTL_HOURS: toEnvValue(input.sessionStateTtlHours),
    SESSION_STATE_MIN_POSTS_TO_SAVE: toEnvValue(input.sessionStateMinPostsToSave),
    SESSION_STATE_RESET_ON_BLOCK: toEnvValue(input.sessionStateResetOnBlock),
    SCHEDULE_TOTAL_MINUTES: toEnvValue(input.scheduleTotalMinutes),
    SCHEDULE_INTERVAL_MINUTES: toEnvValue(input.scheduleIntervalMinutes),
    SCHEDULE_RUN_ANALYZER: toEnvValue(input.scheduleRunAnalyzer),
    ANALYZER_USE_UNFILTERED_POSTS: toEnvValue(input.analyzerUseUnfilteredPosts),
    MAX_POSTS_TO_ANALYZE: toEnvValue(input.maxPostsToAnalyze),
    GEMINI_MODEL: toEnvValue(input.geminiModel),
    GEMINI_BATCH_SIZE: toEnvValue(input.geminiBatchSize),
    GEMINI_TEMPERATURE: toEnvValue(input.geminiTemperature),
    GEMINI_MAX_OUTPUT_TOKENS: toEnvValue(input.geminiMaxOutputTokens),
    PROXY_SERVER: "",
    PROXY_USERNAME: "",
    PROXY_PASSWORD: "",
    PROXY_POOL_DIR: "",
    PROXY_POOL_PROTOCOL: "",
    PROXY_MAX_SESSIONS_PER_PROXY: "",
  };
}

export function buildApifyProxyOptions(input) {
  if (input.noProxy || !input.proxyConfiguration) {
    return null;
  }

  const proxyConfiguration = input.proxyConfiguration;
  const options = {};

  if (Array.isArray(proxyConfiguration.proxyUrls) && proxyConfiguration.proxyUrls.length) {
    options.proxyUrls = proxyConfiguration.proxyUrls;
  }

  if (proxyConfiguration.useApifyProxy !== false) {
    if (Array.isArray(proxyConfiguration.apifyProxyGroups) && proxyConfiguration.apifyProxyGroups.length) {
      options.groups = proxyConfiguration.apifyProxyGroups;
    }

    if (input.proxyCountryCode) {
      options.countryCode = input.proxyCountryCode.toUpperCase();
    }
  }

  if (!options.proxyUrls && proxyConfiguration.useApifyProxy === false) {
    return null;
  }

  return options;
}

export function summarizeApifyProxyOptions(options) {
  if (!options) {
    return null;
  }

  return {
    usesApifyProxy: !Array.isArray(options.proxyUrls),
    groups: Array.isArray(options.groups) ? options.groups : [],
    countryCode: options.countryCode ?? null,
    customProxyUrlCount: Array.isArray(options.proxyUrls) ? options.proxyUrls.length : 0,
  };
}
