function hasCookieBootstrap(cookies) {
  const names = new Set(cookies.map((cookie) => cookie.name));
  return names.has("datr") && names.has("fr");
}

export async function warmupFacebookSession(session, config, logger) {
  if (!config.homeWarmup) {
    return;
  }

  const { context, page } = session;
  await page.goto("https://www.facebook.com/", {
    waitUntil: "domcontentloaded",
  });

  if (config.homeWarmupDelayMs > 0) {
    await page.waitForTimeout(config.homeWarmupDelayMs);
  }

  const cookies = await context.cookies();
  logger.info({
    event: "facebook-home-warmup",
    cookieNames: cookies.map((cookie) => cookie.name).sort(),
    bootstrapped: hasCookieBootstrap(cookies),
    delayMs: config.homeWarmupDelayMs,
  });
}
