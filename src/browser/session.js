import { chromium } from "playwright";
import { redactProxyConfig } from "../utils/redact.js";

export async function launchBrowserSession(config, logger, proxyOverride = config.proxy) {
  const browser = await chromium.launch({
    headless: config.headless,
    proxy: proxyOverride ?? undefined,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: config.browserLocale,
    viewport: { width: 1440, height: 1100 },
    userAgent: config.userAgent,
    colorScheme: "light",
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
  });

  return {
    browser,
    context,
    page,
  };
}

export async function closeBrowserSession(session) {
  await session?.page?.close().catch(() => {});
  await session?.context?.close().catch(() => {});
  await session?.browser?.close().catch(() => {});
}
