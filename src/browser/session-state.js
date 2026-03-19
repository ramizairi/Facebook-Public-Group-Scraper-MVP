import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { redactProxyConfig, summarizeProxyForConsole } from "../utils/redact.js";

function buildIdentityLabel(proxy) {
  if (!proxy?.server) {
    return "direct";
  }

  return `${proxy.server}|${proxy.username ?? ""}`;
}

function buildIdentityHash(proxy) {
  return crypto.createHash("sha256").update(buildIdentityLabel(proxy)).digest("hex").slice(0, 20);
}

function buildFileBase(proxy) {
  return proxy?.server ? `proxy-${buildIdentityHash(proxy)}` : "direct";
}

async function removeFile(filePath) {
  await fs.rm(filePath, { force: true }).catch(() => {});
}

export class SessionStateStore {
  constructor(rootDir, options, logger) {
    this.rootDir = rootDir;
    this.logger = logger;
    this.enabled = options.enabled !== false;
    this.ttlMs = Math.max(1, Number(options.ttlHours ?? 72) * 60 * 60 * 1000);
    this.minPostsToSave = Math.max(0, Number(options.minPostsToSave ?? 1));
    this.resetOnBlock = options.resetOnBlock !== false;
  }

  static async create(config, logger) {
    const rootDir = config.sessionStateDir;
    if (!config.sessionStateEnabled || !rootDir) {
      return null;
    }

    await fs.mkdir(rootDir, { recursive: true });
    const store = new SessionStateStore(
      rootDir,
      {
        enabled: config.sessionStateEnabled,
        ttlHours: config.sessionStateTtlHours,
        minPostsToSave: config.sessionStateMinPostsToSave,
        resetOnBlock: config.sessionStateResetOnBlock,
      },
      logger,
    );
    await store.cleanupExpired();
    return store;
  }

  getPaths(proxy) {
    const base = buildFileBase(proxy);
    return {
      statePath: path.join(this.rootDir, `${base}.json`),
      metaPath: path.join(this.rootDir, `${base}.meta.json`),
      key: base,
    };
  }

  async cleanupExpired() {
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".meta.json")) {
        continue;
      }

      const metaPath = path.join(this.rootDir, entry.name);
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
        const savedAt = meta?.savedAt ? Date.parse(meta.savedAt) : 0;
        if (!savedAt || now - savedAt <= this.ttlMs) {
          continue;
        }

        const statePath = metaPath.replace(/\.meta\.json$/i, ".json");
        await removeFile(metaPath);
        await removeFile(statePath);
      } catch {
        await removeFile(metaPath);
      }
    }
  }

  async load(proxy) {
    if (!this.enabled) {
      return null;
    }

    const paths = this.getPaths(proxy);
    try {
      const [metaRaw] = await Promise.all([
        fs.readFile(paths.metaPath, "utf8"),
        fs.access(paths.statePath),
      ]);
      const meta = JSON.parse(metaRaw);
      const savedAtMs = meta?.savedAt ? Date.parse(meta.savedAt) : 0;
      if (!savedAtMs || Date.now() - savedAtMs > this.ttlMs) {
        await this.clear(proxy, "expired");
        return null;
      }

      this.logger.info({
        event: "session-state-loaded",
        key: paths.key,
        ageMs: Date.now() - savedAtMs,
        proxy: redactProxyConfig(proxy),
      });

      return {
        ...paths,
        meta,
      };
    } catch {
      return null;
    }
  }

  async save(context, proxy, details = {}) {
    if (!this.enabled || !context) {
      return null;
    }

    const posts = Math.max(0, Number(details.posts ?? 0));
    if (posts < this.minPostsToSave && !details.force) {
      return null;
    }

    const paths = this.getPaths(proxy);
    await context.storageState({ path: paths.statePath });
    const meta = {
      key: paths.key,
      savedAt: new Date().toISOString(),
      proxy: {
        summary: summarizeProxyForConsole(proxy),
      },
      bootstrapped: details.bootstrapped === true,
      posts,
      reason: details.reason ?? "session-save",
      loadedFromState: details.loadedFromState === true,
    };
    await fs.writeFile(paths.metaPath, JSON.stringify(meta, null, 2), "utf8");

    this.logger.info({
      event: "session-state-saved",
      key: paths.key,
      posts,
      reason: meta.reason,
      proxy: redactProxyConfig(proxy),
    });

    return {
      ...paths,
      meta,
    };
  }

  async clear(proxy, reason = "cleared") {
    if (!this.enabled) {
      return;
    }

    const paths = this.getPaths(proxy);
    await removeFile(paths.statePath);
    await removeFile(paths.metaPath);

    this.logger.info({
      event: "session-state-cleared",
      key: paths.key,
      reason,
      proxy: redactProxyConfig(proxy),
    });
  }
}
