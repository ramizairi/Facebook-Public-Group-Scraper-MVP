import { closeBrowserSession, launchBrowserSession } from "./session.js";
import { ProxyPool } from "./proxy-pool.js";
import { safeJsonParse } from "../utils/safe-json.js";

export async function runProxyTest(config, outputManager, logger) {
  const proxyPool = await ProxyPool.create(config, logger);
  const selectedProxy = proxyPool?.acquire({ reason: "proxy-test" }) ?? config.proxy;
  const session = await launchBrowserSession(config, logger, selectedProxy);

  try {
    const response = await session.page.goto(config.proxyTestUrl, {
      waitUntil: "domcontentloaded",
    });

    const bodyText =
      (await response?.text().catch(() => null)) ??
      (await session.page.textContent("body").catch(() => null)) ??
      "";

    const parsed = safeJsonParse(bodyText) ?? { raw: bodyText.trim() };
    const payload = {
      ok: Boolean(response?.ok()),
      status: response?.status() ?? null,
      url: config.proxyTestUrl,
      proxyConfigured: Boolean(selectedProxy?.server),
      result: parsed,
    };

    await outputManager.writeDebugJson("proxy-test.json", payload);
    await outputManager.writeStats({
      mode: "proxy-test",
      ...payload,
    });

    console.log(`proxy-test | ok=${payload.ok} | status=${payload.status ?? "n/a"}`);
    return payload;
  } finally {
    await closeBrowserSession(session);
  }
}
