import { closeBrowserSession, launchBrowserSession } from "./session.js";
import { normalizeProxyConfig, ProxyPool } from "./proxy-pool.js";
import { safeJsonParse } from "../utils/safe-json.js";

async function testSingleProxy(config, selectedProxy) {
  const session = await launchBrowserSession(config, { info() {}, warn() {}, error() {} }, selectedProxy);

  try {
    const response = await session.page.goto(config.proxyTestUrl, {
      waitUntil: "domcontentloaded",
    });

    const bodyText =
      (await response?.text().catch(() => null)) ??
      (await session.page.textContent("body").catch(() => null)) ??
      "";

    const parsed = safeJsonParse(bodyText) ?? { raw: bodyText.trim() };
    return {
      ok: Boolean(response?.ok()),
      status: response?.status() ?? null,
      url: config.proxyTestUrl,
      proxyConfigured: Boolean(selectedProxy?.server),
      result: parsed,
      error: null,
    };
  } finally {
    await closeBrowserSession(session);
  }
}

export async function runProxyTest(config, outputManager, logger) {
  const proxyPool = await ProxyPool.create(config, logger);
  if (proxyPool?.hasProxies()) {
    const results = [];

    for (let attempt = 0; attempt < proxyPool.proxies.length; attempt += 1) {
      const selectedProxy = proxyPool.acquire({
        reason: attempt > 0 ? "proxy-test-all" : "proxy-test",
        forceRotate: attempt > 0,
      });

      try {
        const result = await testSingleProxy(config, selectedProxy);
        results.push({
          index: selectedProxy._selection?.index ?? attempt + 1,
          proxy: selectedProxy.server,
          ...result,
          ip: result.result?.ip ?? result.result?.origin ?? null,
        });
        console.log(
          `proxy-test | index=${selectedProxy._selection?.index ?? attempt + 1}/${proxyPool.proxies.length} | ok=${result.ok} | status=${result.status ?? "n/a"}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({
          event: "proxy-test-error",
          attempt: attempt + 1,
          maxAttempts: proxyPool.proxies.length,
          error: message,
        });
        results.push({
          index: selectedProxy._selection?.index ?? attempt + 1,
          proxy: selectedProxy.server,
          ok: false,
          status: null,
          url: config.proxyTestUrl,
          proxyConfigured: Boolean(selectedProxy?.server),
          result: null,
          ip: null,
          error: message,
        });
        console.log(
          `proxy-test | index=${selectedProxy._selection?.index ?? attempt + 1}/${proxyPool.proxies.length} | ok=false | status=n/a`,
        );
      }
    }

    const payload = {
      mode: "proxy-test-all",
      testedAt: new Date().toISOString(),
      total: results.length,
      working: results.filter((item) => item.ok).length,
      failing: results.filter((item) => !item.ok).length,
      url: config.proxyTestUrl,
      results,
    };

    await outputManager.writeDebugJson("proxy-test-summary.json", payload);
    await outputManager.writeStats(payload);

    console.log(
      `proxy-test-summary | working=${payload.working}/${payload.total} | failing=${payload.failing}/${payload.total}`,
    );

    if (payload.working === 0) {
      throw new Error("No working proxies passed the outbound proxy test.");
    }

    return payload;
  }

  if (config.apifyProxyConfiguration) {
    const proxyUrl = await config.apifyProxyConfiguration.newUrl("proxy-test");
    const selectedProxy = proxyUrl ? normalizeProxyConfig({ server: proxyUrl }, "http") : null;
    if (!selectedProxy) {
      throw new Error("Apify proxy configuration did not return a usable proxy URL.");
    }
    const payload = await testSingleProxy(config, selectedProxy);
    await outputManager.writeDebugJson("proxy-test.json", payload);
    await outputManager.writeStats({
      mode: "proxy-test",
      ...payload,
    });
    console.log(`proxy-test | ok=${payload.ok} | status=${payload.status ?? "n/a"} | attempts=1`);
    return payload;
  }

  const payload = await testSingleProxy(config, config.proxy);
  await outputManager.writeDebugJson("proxy-test.json", payload);
  await outputManager.writeStats({
    mode: "proxy-test",
    ...payload,
  });
  console.log(`proxy-test | ok=${payload.ok} | status=${payload.status ?? "n/a"} | attempts=1`);
  return payload;
}
