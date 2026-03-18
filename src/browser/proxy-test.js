import { closeBrowserSession, launchBrowserSession } from "./session.js";
import { safeJsonParse } from "../utils/safe-json.js";

export async function runProxyTest(config, outputManager, logger) {
  const session = await launchBrowserSession(config, logger);

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
      proxyConfigured: Boolean(config.proxy?.server),
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
