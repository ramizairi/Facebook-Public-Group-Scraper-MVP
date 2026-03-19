function hasCookieBootstrap(cookies) {
  const names = new Set(cookies.map((cookie) => cookie.name));
  return names.has("datr") && names.has("fr");
}

export async function warmupFacebookSession(session, config, logger) {
  if (!config.homeWarmup) {
    return {
      cookieNames: [],
      bootstrapped: false,
      skipped: true,
    };
  }

  const { context, page } = session;
  await page.goto("https://www.facebook.com/", {
    waitUntil: "domcontentloaded",
  });

  if (config.homeWarmupDelayMs > 0) {
    await page.waitForTimeout(config.homeWarmupDelayMs);
  }

  const cookies = await context.cookies();
  const cookieNames = cookies.map((cookie) => cookie.name).sort();
  const bootstrapped = hasCookieBootstrap(cookies);
  logger.info({
    event: "facebook-home-warmup",
    cookieNames,
    bootstrapped,
    delayMs: config.homeWarmupDelayMs,
  });

  return {
    cookieNames,
    bootstrapped,
    skipped: false,
  };
}
