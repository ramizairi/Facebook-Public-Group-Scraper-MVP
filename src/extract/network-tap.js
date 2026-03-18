import { nowIso } from "../utils/time.js";
import { classifyResponsePayload } from "./classifier.js";

const MAX_RECENT_ENTRIES = 400;
const MAX_BODY_LENGTH = 2_000_000;

function trimEntryBuffer(entries) {
  if (entries.length > MAX_RECENT_ENTRIES) {
    entries.splice(0, entries.length - MAX_RECENT_ENTRIES);
  }
}

export class NetworkTap {
  constructor(logger) {
    this.logger = logger;
    this.recentEntries = [];
    this.relevantPayloads = [];
    this.nextPayloadIndex = 0;
    this.totalRequests = 0;
    this.totalResponses = 0;
    this.failedRequests = 0;
    this.totalRelevantResponses = 0;
  }

  attach(page) {
    this.detach();
    this.page = page;

    this.onRequest = (request) => {
      this.totalRequests += 1;
      this.recentEntries.push({
        type: "request",
        at: nowIso(),
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
      });
      trimEntryBuffer(this.recentEntries);
    };

    this.onRequestFailed = (request) => {
      this.failedRequests += 1;
      this.recentEntries.push({
        type: "requestfailed",
        at: nowIso(),
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
        failureText: request.failure()?.errorText ?? null,
      });
      trimEntryBuffer(this.recentEntries);
    };

    this.onResponse = async (response) => {
      this.totalResponses += 1;
      const request = response.request();
      const entry = {
        type: "response",
        at: nowIso(),
        method: request.method(),
        resourceType: request.resourceType(),
        url: response.url(),
        status: response.status(),
      };

      const contentType = response.headers()["content-type"] ?? "";
      let body = "";
      let classification = { relevant: false, score: 0, reasons: [] };

      try {
        const isFacebookPageUrl = /https:\/\/www\.facebook\.com\//i.test(entry.url);
        const bodyAllowed =
          (isFacebookPageUrl &&
            (/text\/html|javascript|json/i.test(contentType) ||
              /\/ajax\/bz|\/ajax\/bulk-route-definitions|\/graphql|\/api\/graphql|\/groups\//i.test(entry.url)) &&
            /document|xhr|fetch|other/i.test(entry.resourceType));

        if (bodyAllowed) {
          body = await response.text();
          if (body.length > MAX_BODY_LENGTH) {
            body = body.slice(0, MAX_BODY_LENGTH);
          }

          classification = classifyResponsePayload({
            ...entry,
            contentType,
            body,
          });
        }
      } catch (error) {
        entry.bodyReadError = error instanceof Error ? error.message : String(error);
      }

      entry.contentType = contentType;
      entry.relevant = classification.relevant;
      entry.relevanceScore = classification.score;
      entry.relevanceReasons = classification.reasons;
      this.recentEntries.push(entry);
      trimEntryBuffer(this.recentEntries);

      if (classification.relevant) {
        this.totalRelevantResponses += 1;
        this.relevantPayloads.push({
          id: `${Date.now()}-${this.relevantPayloads.length + 1}`,
          capturedAt: entry.at,
          url: entry.url,
          method: entry.method,
          status: entry.status,
          contentType,
          body,
          resourceType: entry.resourceType,
          reasons: classification.reasons,
        });
      }
    };

    page.on("request", this.onRequest);
    page.on("requestfailed", this.onRequestFailed);
    page.on("response", this.onResponse);
  }

  detach() {
    if (!this.page) {
      return;
    }

    if (this.onRequest) {
      this.page.off("request", this.onRequest);
    }

    if (this.onRequestFailed) {
      this.page.off("requestfailed", this.onRequestFailed);
    }

    if (this.onResponse) {
      this.page.off("response", this.onResponse);
    }

    this.page = null;
    this.onRequest = null;
    this.onRequestFailed = null;
    this.onResponse = null;
  }

  drainRelevantPayloads() {
    const drained = this.relevantPayloads.slice(this.nextPayloadIndex);
    this.relevantPayloads = [];
    this.nextPayloadIndex = 0;
    return drained;
  }

  getRecentEntries(limit = 100) {
    return this.recentEntries.slice(-limit);
  }

  getStats() {
    return {
      totalRequests: this.totalRequests,
      totalResponses: this.totalResponses,
      failedRequests: this.failedRequests,
      relevantResponses: this.totalRelevantResponses,
    };
  }
}
