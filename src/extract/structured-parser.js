import { classifyDocumentHtml } from "./classifier.js";
import { extractPostInfoFromUrl, normalizeGroupUrl } from "../utils/facebook-url.js";
import { safeJsonParse, safeJsonParseMany, stripFacebookPrefix } from "../utils/safe-json.js";

const SCRIPT_JSON_REGEX = /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
function uniqBy(items, keySelector) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = keySelector(item);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function trimText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length ? normalized : null;
}

function toIsoTimestamp(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const millis = value > 1_000_000_000_000 ? value : value * 1_000;
  return new Date(millis).toISOString();
}

function getString(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function isUsefulMessageText(value) {
  const normalized = trimText(value);
  if (!normalized) {
    return null;
  }

  if (/^story$/i.test(normalized)) {
    return null;
  }

  if (/^[A-Za-z0-9_-]{180,}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function findNestedMessageText(value, depth = 0) {
  if (depth > 8 || value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findNestedMessageText(item, depth + 1);
      if (match) {
        return match;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const directCandidates = [
    value.message?.text,
    value.message_preferred_body?.text,
    value.translation?.message?.text,
    value.comet_sections?.content?.story?.message?.text,
    value.comet_sections?.context_layout?.story?.message?.text,
    value.story?.message?.text,
    value.story?.comet_sections?.content?.story?.message?.text,
  ];

  for (const candidate of directCandidates) {
    const useful = isUsefulMessageText(candidate);
    if (useful) {
      return useful;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (
      key === "message" ||
      key === "message_preferred_body" ||
      key === "translation" ||
      key === "comet_sections" ||
      key === "content" ||
      key === "story" ||
      key === "context_layout" ||
      key === "attachments"
    ) {
      const match = findNestedMessageText(nestedValue, depth + 1);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

function findActor(value, depth = 0) {
  if (depth > 10 || value == null || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const actor = findActor(item, depth + 1);
      if (actor) {
        return actor;
      }
    }

    return null;
  }

  if (Array.isArray(value.actors) && value.actors.length) {
    const [actor] = value.actors;
    return {
      name: trimText(actor?.name) ?? null,
      id: getString(actor?.id),
    };
  }

  for (const nestedValue of Object.values(value)) {
    const actor = findActor(nestedValue, depth + 1);
    if (actor) {
      return actor;
    }
  }

  return null;
}

function findFirstNumericMetric(value, pathHints, depth = 0, path = []) {
  if (depth > 10 || value == null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (path.some((segment) => pathHints.some((hint) => segment.toLowerCase().includes(hint)))) {
      return Math.max(0, Math.trunc(value));
    }

    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findFirstNumericMetric(item, pathHints, depth + 1, path);
      if (match != null) {
        return match;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const match = findFirstNumericMetric(nestedValue, pathHints, depth + 1, [...path, key]);
    if (match != null) {
      return match;
    }
  }

  return null;
}

function collectMedia(value, depth = 0, path = [], found = []) {
  if (depth > 3 || value == null || found.length >= 8) {
    return found;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMedia(item, depth + 1, path, found);
    }

    return found;
  }

  if (typeof value !== "object") {
    return found;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === "string" && /^https?:\/\//i.test(nestedValue)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("image") ||
        lowerKey.includes("photo") ||
        lowerKey.includes("video") ||
        lowerKey.includes("uri") ||
        lowerKey.includes("playable")
      ) {
        found.push({
          type: lowerKey.includes("video") || lowerKey.includes("playable") ? "video" : "image",
          url: nestedValue,
        });
      }
    } else {
      collectMedia(nestedValue, depth + 1, [...path, key], found);
    }

    if (found.length >= 8) {
      break;
    }
  }

  return found;
}

function parseTracking(value) {
  const normalized = getString(value);
  if (!normalized || !normalized.includes("{")) {
    return {};
  }

  try {
    return JSON.parse(normalized);
  } catch {
    return {};
  }
}

function extractCandidate(node, context) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return null;
  }

  const directUrl = getString(node.url) ?? getString(node.story_url) ?? getString(node.permalink_url);
  const tracking = parseTracking(node.tracking);
  const trackedPostId = getString(tracking.top_level_post_id) ?? getString(tracking.mf_story_key);
  const postId =
    getString(node.post_id) ??
    getString(node.top_level_post_id) ??
    getString(node.story_fbid) ??
    getString(node.mf_story_key) ??
    trackedPostId;
  const postInfo = extractPostInfoFromUrl(directUrl);
  const stablePostId = postInfo?.postId ?? postId;
  const effectiveGroupUrl =
    normalizeGroupUrl(node.groupUrl) ??
    (postInfo ? `https://www.facebook.com/groups/${postInfo.groupSlugOrId}/` : context.groupUrl);

  if (!stablePostId || !effectiveGroupUrl) {
    return null;
  }

  const author = findActor(node);
  const createdAtRaw =
    typeof node.creation_time === "number"
      ? node.creation_time
      : typeof node.publish_time === "number"
        ? node.publish_time
        : findFirstNumericMetric(node, ["creation_time", "publish_time"]);

  return {
    id: stablePostId,
    url: postInfo?.canonicalUrl ?? `${effectiveGroupUrl}posts/${stablePostId}/`,
    groupUrl: effectiveGroupUrl,
    authorName: author?.name ?? null,
    authorId: author?.id ?? getString(tracking.original_content_owner_id) ?? getString(tracking.content_owner_id_new),
    createdAt: createdAtRaw ? toIsoTimestamp(createdAtRaw) : null,
    text: findNestedMessageText(node),
    media: uniqBy(collectMedia(node), (item) => `${item.type}:${item.url}`),
    reactionCount: findFirstNumericMetric(node, ["reaction", "reactor", "feedback"]),
    commentCount: findFirstNumericMetric(node, ["comment"]),
    shareCount: findFirstNumericMetric(node, ["share"]),
    sourceType: context.sourceType,
    rawFragment: {
      source: context.sourceLabel,
      sourceUrl: context.sourceUrl ?? null,
      keys: Object.keys(node).slice(0, 12),
      reference: `${stablePostId}:${context.sourceLabel}`,
    },
  };
}

function traverseForPosts(root, context) {
  const seenObjects = new WeakSet();
  const collected = [];

  function visit(node, depth = 0) {
    if (depth > 32 || node == null || typeof node !== "object") {
      return;
    }

    if (seenObjects.has(node)) {
      return;
    }

    seenObjects.add(node);
    const candidate = extractCandidate(node, context);
    if (candidate) {
      collected.push(candidate);
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, depth + 1);
      }

      return;
    }

    for (const value of Object.values(node)) {
      visit(value, depth + 1);
    }
  }

  visit(root);

  return uniqBy(collected, (item) => item.id || item.url);
}

export function extractStructuredPostsFromPayload(payload, context) {
  const body = stripFacebookPrefix(payload.body ?? "");
  const parsedDocuments = safeJsonParseMany(body);
  if (!parsedDocuments.length) {
    return [];
  }

  const collected = [];
  for (const parsed of parsedDocuments) {
    collected.push(
      ...traverseForPosts(parsed, {
        sourceType: "network",
        sourceLabel: "network-response",
        sourceUrl: payload.url,
        groupUrl: context.groupUrl,
      }),
    );
  }

  return uniqBy(collected, (item) => item.id || item.url);
}

export function extractStructuredPostsFromDocument(html, context) {
  const documentClassification = classifyDocumentHtml(html);
  if (!documentClassification.relevant) {
    return [];
  }

  const collected = [];

  for (const match of html.matchAll(SCRIPT_JSON_REGEX)) {
    const scriptBody = match[1];
    if (!/post_id|creation_time|comet_sections|queryID|feedback|actors|__bbox/i.test(scriptBody)) {
      continue;
    }

    const parsed = safeJsonParse(scriptBody);
    if (!parsed) {
      continue;
    }

    collected.push(
      ...traverseForPosts(parsed, {
        sourceType: "network",
        sourceLabel: "document-embedded-json",
        sourceUrl: context.groupUrl,
        groupUrl: context.groupUrl,
      }),
    );
  }

  return uniqBy(collected, (item) => item.id || item.url);
}
