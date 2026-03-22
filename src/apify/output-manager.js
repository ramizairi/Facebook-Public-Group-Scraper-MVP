import { Actor } from "apify";
import { toOutputRows } from "../output/output-row.js";

function buildTimestampLabel() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toDebugStoreKey(fileName) {
  return `debug-${String(fileName).replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
}

export class ApifyOutputManager {
  constructor(payloadSampleLimit = 12) {
    this.payloadSampleLimit = payloadSampleLimit;
    this.savedPayloadIds = new Set();
    this.paths = {
      root: "apify://default-storage",
      logsDir: null,
      debugDir: null,
      outputJson: "output.json",
      postsJson: "posts.json",
      postsJsonl: "dataset://default",
      statsJson: "stats.json",
      logFile: null,
    };
  }

  static async create(payloadSampleLimit = 12) {
    return new ApifyOutputManager(payloadSampleLimit);
  }

  async resetPosts(posts, unfilteredPosts = posts) {
    await Actor.setValue("output.json", toOutputRows(posts));
    await Actor.setValue("posts.json", posts);
  }

  async appendPosts(_posts, unfilteredPosts = []) {
    if (_posts.length) {
      await Actor.pushData(_posts);
    }
  }

  async writePostsJson(posts, unfilteredPosts = posts) {
    await Actor.setValue("output.json", toOutputRows(posts));
    await Actor.setValue("posts.json", posts);
  }

  async writeStats(stats) {
    await Actor.setValue("stats.json", stats);
  }

  async writeCheckpoint(checkpoint) {
    await Actor.setValue("checkpoint.json", checkpoint);
  }

  async writeDebugJson(fileName, payload) {
    await Actor.setValue(toDebugStoreKey(fileName), payload);
  }

  async writeDebugText(fileName, payload) {
    await Actor.setValue(toDebugStoreKey(fileName), payload, {
      contentType: "text/plain; charset=utf-8",
    });
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

  async captureFailure(_page, networkTap, label, extra = {}) {
    const suffix = buildTimestampLabel();
    await this.writeDebugJson(`failure-${label}-${suffix}-network.json`, networkTap?.getRecentEntries(120) ?? []);
    await this.writeDebugJson(`failure-${label}-${suffix}.json`, {
      label,
      capturedAt: new Date().toISOString(),
      ...extra,
    });
  }
}
