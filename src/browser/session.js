import { chromium } from "playwright";
import { prepareBrowserProxy } from "./proxy-bridge.js";
import { redactProxyConfig, summarizeProxyForConsole } from "../utils/redact.js";

export async function launchBrowserSession(
  config,
  logger,
  proxyOverride = config.proxy,
  sessionState = null,
) {
  const preparedProxy = await prepareBrowserProxy(proxyOverride, logger);
  const browser = await chromium.launch({
    headless: config.headless,
    proxy: preparedProxy.launchProxy ?? undefined,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: config.browserLocale,
    viewport: { width: 1440, height: 1100 },
    userAgent: config.userAgent,
    colorScheme: "light",
    ...(sessionState?.statePath ? { storageState: sessionState.statePath } : {}),
    ...(config.browserTimezone ? { timezoneId: config.browserTimezone } : {}),
  });
  await context.setExtraHTTPHeaders({
    "Accept-Language": `${config.browserLocale},en;q=0.9`,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    window.chrome = window.chrome || { runtime: {} };
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  page.setDefaultTimeout(config.navigationTimeoutMs);

  logger.info({
    event: "browser-session-started",
    headless: config.headless,
    proxy: redactProxyConfig(proxyOverride),
    sessionStateLoaded: Boolean(sessionState?.statePath),
  });

  if (proxyOverride?.server) {
    const selection = proxyOverride._selection ?? { mode: "single" };
    const summary = [
      "proxy",
      `mode=${selection.mode ?? "single"}`,
      `server=${summarizeProxyForConsole(proxyOverride)}`,
    ];

    if (selection.index && selection.count) {
      summary.push(`index=${selection.index}/${selection.count}`);
    }

    if (selection.reason) {
      summary.push(`reason=${selection.reason}`);
    }

    console.log(summary.join(" | "));
  }

  return {
    browser,
    context,
    page,
    loadedSessionState: sessionState,
    cleanupProxy: preparedProxy.cleanup,
  };
}

export async function closeBrowserSession(session) {
  await session?.page?.close().catch(() => {});
  await session?.context?.close().catch(() => {});
  await session?.browser?.close().catch(() => {});
  await session?.cleanupProxy?.().catch(() => {});
}
