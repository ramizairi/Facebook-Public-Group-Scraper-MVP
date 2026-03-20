import fs from "node:fs/promises";
import path from "node:path";

import { persistCheckpoint } from "../core/checkpoint.js";
import { toOutputRows } from "./output-row.js";
import { safeJsonStringify } from "../utils/safe-json.js";

function buildTimestampLabel() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function cleanupLegacyDebugArtifacts(debugDir) {
  const entries = await fs.readdir(debugDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!/\.(?:png|html)$/i.test(entry.name)) {
      continue;
    }

    await fs.rm(path.join(debugDir, entry.name), { force: true });
  }
}

async function cleanupLegacyOutputArtifacts(outputDir) {
  const legacyFiles = [
    "posts.unfiltered.json",
    "posts.unfiltered.jsonl",
  ];

  await Promise.all(
    legacyFiles.map((fileName) => fs.rm(path.join(outputDir, fileName), { force: true })),
  );
}

export class OutputManager {
  constructor(paths, payloadSampleLimit = 12) {
    this.paths = paths;
    this.payloadSampleLimit = payloadSampleLimit;
    this.savedPayloadIds = new Set();
  }

  static async create(outputDir, payloadSampleLimit = 12) {
    const paths = {
      root: outputDir,
      logsDir: path.join(outputDir, "logs"),
      debugDir: path.join(outputDir, "debug"),
      outputJson: path.join(outputDir, "output.json"),
      postsJson: path.join(outputDir, "posts.json"),
      postsJsonl: path.join(outputDir, "posts.jsonl"),
      statsJson: path.join(outputDir, "stats.json"),
      logFile: path.join(outputDir, "logs", "run.log"),
    };

    await fs.mkdir(paths.root, { recursive: true });
    await fs.mkdir(paths.logsDir, { recursive: true });
    await fs.mkdir(paths.debugDir, { recursive: true });
    await cleanupLegacyOutputArtifacts(paths.root);
    await cleanupLegacyDebugArtifacts(paths.debugDir);

    return new OutputManager(paths, payloadSampleLimit);
  }

  async resetPosts(posts, unfilteredPosts = posts) {
    await fs.writeFile(this.paths.outputJson, safeJsonStringify(toOutputRows(posts)), "utf8");
    await fs.writeFile(this.paths.postsJson, safeJsonStringify(unfilteredPosts), "utf8");
    const unfilteredJsonl = unfilteredPosts.map((post) => JSON.stringify(post)).join("\n");
    await fs.writeFile(this.paths.postsJsonl, unfilteredJsonl ? `${unfilteredJsonl}\n` : "", "utf8");
  }

  async appendPosts(posts, unfilteredPosts = posts) {
    if (unfilteredPosts.length) {
      const unfilteredLines = unfilteredPosts.map((post) => JSON.stringify(post)).join("\n");
      await fs.appendFile(this.paths.postsJsonl, `${unfilteredLines}\n`, "utf8");
    }
  }

  async writePostsJson(posts, unfilteredPosts = posts) {
    await fs.writeFile(this.paths.outputJson, safeJsonStringify(toOutputRows(posts)), "utf8");
    await fs.writeFile(this.paths.postsJson, safeJsonStringify(unfilteredPosts), "utf8");
  }

  async writeStats(stats) {
    await fs.writeFile(this.paths.statsJson, safeJsonStringify(stats), "utf8");
  }

  async writeCheckpoint(checkpoint) {
    await persistCheckpoint(this.paths.root, checkpoint);
  }

  async writeDebugJson(fileName, payload) {
    await fs.writeFile(path.join(this.paths.debugDir, fileName), safeJsonStringify(payload), "utf8");
  }

  async writeDebugText(fileName, payload) {
    await fs.writeFile(path.join(this.paths.debugDir, fileName), payload, "utf8");
  }

  async writePayloadSamples(payloads) {
    for (const payload of payloads) {
      if (this.savedPayloadIds.size >= this.payloadSampleLimit) {
        break;
      }

      if (this.savedPayloadIds.has(payload.id)) {
        continue;
      }

      this.savedPayloadIds.add(payload.id);
      const sequence = String(this.savedPayloadIds.size).padStart(3, "0");
      const suffix = buildTimestampLabel();
      await this.writeDebugJson(`payload-${sequence}-${suffix}.json`, {
        capturedAt: payload.capturedAt,
        url: payload.url,
        method: payload.method,
        status: payload.status,
        contentType: payload.contentType,
        reasons: payload.reasons,
        body: payload.body,
      });
    }
  }

  async captureFailure(page, networkTap, label, extra = {}) {
    const suffix = buildTimestampLabel();
    const networkFile = `failure-${label}-${suffix}-network.json`;
    const metaFile = `failure-${label}-${suffix}.json`;

    await this.writeDebugJson(networkFile, networkTap?.getRecentEntries(120) ?? []);
    await this.writeDebugJson(metaFile, {
      label,
      capturedAt: new Date().toISOString(),
      ...extra,
    });
  }
}
