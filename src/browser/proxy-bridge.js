import { anonymizeProxy, closeAnonymizedProxy } from "proxy-chain";

import { redactProxyConfig } from "../utils/redact.js";

export function buildProxyUrl(proxy) {
  if (!proxy?.server) {
    return null;
  }

  const parsed = new URL(proxy.server);
  if (proxy.username) {
    parsed.username = encodeURIComponent(proxy.username);
  }

  if (proxy.password) {
    parsed.password = encodeURIComponent(proxy.password);
  }

  return parsed.toString();
}

export async function prepareBrowserProxy(proxy, logger) {
  if (!proxy?.server) {
    return {
      launchProxy: null,
      cleanup: async () => {},
      upstreamProxy: null,
    };
  }

  const upstreamProxyUrl = buildProxyUrl(proxy);
  const browserProxyUrl = await anonymizeProxy(upstreamProxyUrl);
  const usingLocalBridge = browserProxyUrl !== upstreamProxyUrl;

  logger.info({
    event: "proxy-prepared-for-browser",
    proxy: redactProxyConfig(proxy),
    usingLocalBridge,
  });

  return {
    launchProxy: {
      server: browserProxyUrl,
    },
    upstreamProxy: proxy,
    cleanup: async () => {
      if (!usingLocalBridge) {
        return;
      }

      await closeAnonymizedProxy(browserProxyUrl, true).catch(() => {});
    },
  };
}
