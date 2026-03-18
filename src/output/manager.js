import fs from "node:fs/promises";
import path from "node:path";

import { safeJsonStringify } from "../utils/safe-json.js";

function buildTimestampLabel() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
      postsJson: path.join(outputDir, "posts.json"),
      postsJsonl: path.join(outputDir, "posts.jsonl"),
      postsUnfilteredJson: path.join(outputDir, "posts.unfiltered.json"),
      postsUnfilteredJsonl: path.join(outputDir, "posts.unfiltered.jsonl"),
      statsJson: path.join(outputDir, "stats.json"),
      logFile: path.join(outputDir, "logs", "run.log"),
    };

    await fs.mkdir(paths.root, { recursive: true });
    await fs.mkdir(paths.logsDir, { recursive: true });
    await fs.mkdir(paths.debugDir, { recursive: true });

    return new OutputManager(paths, payloadSampleLimit);
  }

  async resetPosts(posts, unfilteredPosts = posts) {
    await fs.writeFile(this.paths.postsJson, safeJsonStringify(posts), "utf8");
    const filteredJsonl = posts.map((post) => JSON.stringify(post)).join("\n");
    await fs.writeFile(this.paths.postsJsonl, filteredJsonl ? `${filteredJsonl}\n` : "", "utf8");

    await fs.writeFile(this.paths.postsUnfilteredJson, safeJsonStringify(unfilteredPosts), "utf8");
    const unfilteredJsonl = unfilteredPosts.map((post) => JSON.stringify(post)).join("\n");
    await fs.writeFile(this.paths.postsUnfilteredJsonl, unfilteredJsonl ? `${unfilteredJsonl}\n` : "", "utf8");
  }

  async appendPosts(posts, unfilteredPosts = posts) {
    if (posts.length) {
      const filteredLines = posts.map((post) => JSON.stringify(post)).join("\n");
      await fs.appendFile(this.paths.postsJsonl, `${filteredLines}\n`, "utf8");
    }

    if (unfilteredPosts.length) {
      const unfilteredLines = unfilteredPosts.map((post) => JSON.stringify(post)).join("\n");
      await fs.appendFile(this.paths.postsUnfilteredJsonl, `${unfilteredLines}\n`, "utf8");
    }
  }

  async writePostsJson(posts, unfilteredPosts = posts) {
    await fs.writeFile(this.paths.postsJson, safeJsonStringify(posts), "utf8");
    await fs.writeFile(this.paths.postsUnfilteredJson, safeJsonStringify(unfilteredPosts), "utf8");
  }

  async writeStats(stats) {
    await fs.writeFile(this.paths.statsJson, safeJsonStringify(stats), "utf8");
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
    const screenshotFile = path.join(this.paths.debugDir, `failure-${label}-${suffix}.png`);
    const htmlFile = `failure-${label}-${suffix}.html`;
    const networkFile = `failure-${label}-${suffix}-network.json`;
    const metaFile = `failure-${label}-${suffix}.json`;

    try {
      await page.screenshot({ path: screenshotFile, fullPage: true });
    } catch {
      // Ignore screenshot failures when the page is already gone.
    }

    try {
      const html = await page.content();
      await this.writeDebugText(htmlFile, html);
    } catch {
      // Ignore HTML capture failures when the page is already gone.
    }

    await this.writeDebugJson(networkFile, networkTap?.getRecentEntries(120) ?? []);
    await this.writeDebugJson(metaFile, {
      label,
      capturedAt: new Date().toISOString(),
      ...extra,
    });
  }
}
