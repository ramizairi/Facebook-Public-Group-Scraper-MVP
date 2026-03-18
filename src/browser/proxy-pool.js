import fs from "node:fs/promises";
import path from "node:path";

import { redactProxyConfig } from "../utils/redact.js";

function buildProxyKey(proxy) {
  return `${proxy.server}|${proxy.username ?? ""}|${proxy.password ?? ""}`;
}

export function parseProxyLine(line, defaultProtocol = "socks5") {
  const normalized = String(line ?? "").trim();
  if (!normalized || normalized.startsWith("#")) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      return {
        server: `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ""}`,
        username: parsedUrl.username || undefined,
        password: parsedUrl.password || undefined,
      };
    } catch {
      return null;
    }
  }

  const csvParts = normalized.split(",").map((part) => part.trim());
  if (csvParts.length >= 2) {
    const [host, port, username, ...passwordParts] = csvParts;
    if (host && port) {
      return {
        server: `${defaultProtocol}://${host}:${port}`,
        username: username || undefined,
        password: passwordParts.join(",").trim() || undefined,
      };
    }
  }

  const authAtMatch = normalized.match(/^([^:@/\s]+):([^@/\s]*)@([^:/\s]+):(\d+)$/);
  if (authAtMatch) {
    const [, username, password, host, port] = authAtMatch;
    return {
      server: `${defaultProtocol}://${host}:${port}`,
      username: username || undefined,
      password: password || undefined,
    };
  }

  const parts = normalized.split(":");
  if (parts.length < 2) {
    return null;
  }

  const [host, port, username, ...passwordParts] = parts;
  const trimmedHost = host?.trim();
  const trimmedPort = port?.trim();

  if (!trimmedHost || !trimmedPort) {
    return null;
  }

  return {
    server: `${defaultProtocol}://${trimmedHost}:${trimmedPort}`,
    username: username?.trim() || undefined,
    password: passwordParts.join(":").trim() || undefined,
  };
}

export function normalizeProxyConfig(proxy, defaultProtocol = "http") {
  if (!proxy?.server) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(proxy.server)) {
    return {
      server: proxy.server,
      username: proxy.username || undefined,
      password: proxy.password || undefined,
    };
  }

  const normalized = parseProxyLine(
    [proxy.server, proxy.username || "", proxy.password || ""]
      .filter((part, index) => index < 2 || part)
      .join(":"),
    defaultProtocol,
  );

  return (
    normalized ?? {
      server: proxy.server,
      username: proxy.username || undefined,
      password: proxy.password || undefined,
    }
  );
}

async function readProxyFiles(proxyPoolDir, defaultProtocol) {
  const entries = await fs.readdir(proxyPoolDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const proxies = [];
  for (const fileName of files) {
    const filePath = path.join(proxyPoolDir, fileName);
    const raw = await fs.readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const proxy = parseProxyLine(line, defaultProtocol);
      if (proxy) {
        proxies.push(proxy);
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const proxy of proxies) {
    const key = buildProxyKey(proxy);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(proxy);
  }

  return deduped;
}

export class ProxyPool {
  constructor(proxies, options, logger) {
    this.proxies = proxies;
    this.logger = logger;
    this.maxSessionsPerProxy = Math.max(1, options.maxSessionsPerProxy ?? 1);
    this.currentIndex = -1;
    this.sessionsOnCurrentProxy = 0;
  }

  static async create(config, logger) {
    if (!config.proxyPoolDir) {
      return null;
    }

    try {
      const proxies = await readProxyFiles(config.proxyPoolDir, config.proxyPoolProtocol);
      if (!proxies.length) {
        logger.warn({
          event: "proxy-pool-empty",
          proxyPoolDir: config.proxyPoolDir,
        });
        return null;
      }

      logger.info({
        event: "proxy-pool-loaded",
        proxyPoolDir: config.proxyPoolDir,
        proxyPoolProtocol: config.proxyPoolProtocol,
        proxyCount: proxies.length,
        maxSessionsPerProxy: config.proxyMaxSessionsPerProxy,
      });

      return new ProxyPool(
        proxies,
        {
          maxSessionsPerProxy: config.proxyMaxSessionsPerProxy,
        },
        logger,
      );
    } catch (error) {
      logger.warn({
        event: "proxy-pool-load-failed",
        proxyPoolDir: config.proxyPoolDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  hasProxies() {
    return this.proxies.length > 0;
  }

  acquire({ reason = "session-start", forceRotate = false } = {}) {
    if (!this.proxies.length) {
      return null;
    }

    if (
      this.currentIndex === -1 ||
      forceRotate ||
      this.sessionsOnCurrentProxy >= this.maxSessionsPerProxy
    ) {
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      this.sessionsOnCurrentProxy = 0;
    }

    this.sessionsOnCurrentProxy += 1;
    const proxy = {
      ...this.proxies[this.currentIndex],
      _selection: {
        mode: "pool",
        index: this.currentIndex + 1,
        count: this.proxies.length,
        reason,
        sessionCountOnProxy: this.sessionsOnCurrentProxy,
      },
    };

    this.logger.info({
      event: "proxy-selected",
      reason,
      proxyIndex: this.currentIndex + 1,
      proxyCount: this.proxies.length,
      sessionCountOnProxy: this.sessionsOnCurrentProxy,
      proxy: redactProxyConfig(proxy),
    });

    return proxy;
  }
}
