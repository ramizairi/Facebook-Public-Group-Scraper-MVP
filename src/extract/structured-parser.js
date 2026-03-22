import { classifyDocumentHtml } from "./classifier.js";
import { extractGroupSlugOrId, extractPostInfoFromUrl, normalizeGroupUrl } from "../utils/facebook-url.js";
import { safeJsonParse, safeJsonParseMany, stripFacebookPrefix } from "../utils/safe-json.js";

const SCRIPT_JSON_REGEX = /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
const MESSAGE_RECURSION_KEYS = new Set([
  "message",
  "message_preferred_body",
  "preferred_body",
  "preferred_body_renderer",
  "body",
  "body_renderer",
  "translation",
  "comet_sections",
  "content",
  "story",
  "context_layout",
  "attachments",
  "message_container",
  "shareable_from_perspective_of_feed_ufi",
  "shareable",
  "attached_story",
]);
const CANDIDATE_DISCOVERY_KEYS = new Set([
  "feedback",
  "attachments",
  "attachment",
  "story_attachment",
  "story_attachments",
  "comet_sections",
  "content",
  "story",
  "context_layout",
  "message_container",
  "shareable_from_perspective_of_feed_ufi",
  "shareable",
  "attached_story",
  "native_template_view",
  "target",
  "target_group",
  "associated_group",
  "group",
  "to",
]);
const SHALLOW_PLUGIN_KEYS = new Set([
  "__typename",
  "group_id",
  "post_id",
  "top_level_post_id",
  "mf_story_key",
  "tracking",
]);
const STORY_TYPENAME_HINTS = [
  "story",
  "feedunit",
  "feed_unit",
  "shareable",
  "groupmallpost",
  "groupent",
  "groupscometfeed",
];
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

function collectDirectMessageCandidates(value) {
  return [
    value.message?.text,
    value.message_preferred_body?.text,
    value.preferred_body?.text,
    value.preferred_body_renderer?.text,
    value.body?.text,
    value.body_renderer?.text,
    value.translation?.message?.text,
    value.translation?.preferred_body?.text,
    value.translation?.body?.text,
    value.translation?.body_renderer?.text,
    value.story?.message?.text,
    value.story?.preferred_body?.text,
    value.story?.body?.text,
    value.story?.body_renderer?.text,
    value.story?.message_container?.story?.message?.text,
    value.story?.message_container?.story?.preferred_body?.text,
    value.story?.message_container?.story?.body?.text,
    value.story?.message_container?.story?.body_renderer?.text,
    value.message_container?.story?.message?.text,
    value.message_container?.story?.preferred_body?.text,
    value.message_container?.story?.body?.text,
    value.message_container?.story?.body_renderer?.text,
    value.comet_sections?.content?.story?.message?.text,
    value.comet_sections?.content?.story?.preferred_body?.text,
    value.comet_sections?.content?.story?.body?.text,
    value.comet_sections?.content?.story?.body_renderer?.text,
    value.comet_sections?.content?.story?.message_container?.story?.message?.text,
    value.comet_sections?.content?.story?.message_container?.story?.preferred_body?.text,
    value.comet_sections?.content?.story?.message_container?.story?.body?.text,
    value.comet_sections?.content?.story?.message_container?.story?.body_renderer?.text,
    value.comet_sections?.content?.story?.comet_sections?.message?.story?.message?.text,
    value.comet_sections?.content?.story?.comet_sections?.message?.story?.preferred_body?.text,
    value.comet_sections?.content?.story?.comet_sections?.message?.story?.body?.text,
    value.comet_sections?.content?.story?.comet_sections?.message?.story?.body_renderer?.text,
    value.comet_sections?.content?.story?.comet_sections?.message_container?.story?.message?.text,
    value.comet_sections?.content?.story?.comet_sections?.message_container?.story?.preferred_body?.text,
    value.comet_sections?.content?.story?.comet_sections?.message_container?.story?.body?.text,
    value.comet_sections?.content?.story?.comet_sections?.message_container?.story?.body_renderer?.text,
    value.comet_sections?.context_layout?.story?.message?.text,
    value.comet_sections?.context_layout?.story?.preferred_body?.text,
    value.comet_sections?.context_layout?.story?.body?.text,
    value.comet_sections?.context_layout?.story?.body_renderer?.text,
    value.shareable_from_perspective_of_feed_ufi?.message?.text,
    value.shareable_from_perspective_of_feed_ufi?.preferred_body?.text,
    value.shareable_from_perspective_of_feed_ufi?.body?.text,
    value.shareable_from_perspective_of_feed_ufi?.body_renderer?.text,
  ];
}

function findNestedMessageText(value, depth = 0) {
  if (depth > 12 || value == null) {
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

  if (looksLikeCommentNode(value)) {
    return null;
  }

  for (const candidate of collectDirectMessageCandidates(value)) {
    const useful = isUsefulMessageText(candidate);
    if (useful) {
      return useful;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!MESSAGE_RECURSION_KEYS.has(key)) {
      continue;
    }

    const match = findNestedMessageText(nestedValue, depth + 1);
    if (match) {
      return match;
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

  const directActorCandidates = [
    value.author,
    value.owning_profile,
    value.actor,
  ];

  for (const candidate of directActorCandidates) {
    const name = trimText(candidate?.name);
    const id = getString(candidate?.id);
    if (name || id) {
      return {
        name: name ?? null,
        id,
      };
    }
  }

  for (const nestedValue of Object.values(value)) {
    const actor = findActor(nestedValue, depth + 1);
    if (actor) {
      return actor;
    }
  }

  return null;
}

function findFirstGroupInfo(value, depth = 0) {
  if (depth > 10 || value == null) {
    return { id: null, url: null };
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findFirstGroupInfo(item, depth + 1);
      if (match.id || match.url) {
        return match;
      }
    }

    return { id: null, url: null };
  }

  if (typeof value !== "object") {
    return { id: null, url: null };
  }

  const directCandidates = [
    {
      id: getString(value.associated_group?.id),
      url: getString(value.associated_group?.url),
    },
    {
      id: getString(value.target_group?.id),
      url: getString(value.target_group?.url),
    },
    {
      id: getString(value.group?.id),
      url: getString(value.group?.url),
    },
    {
      id: getString(value.to?.id),
      url: getString(value.to?.url),
    },
    {
      id: getString(value.group_id),
      url: getString(value.group_url),
    },
  ];

  for (const candidate of directCandidates) {
    if (candidate.id || candidate.url) {
      return candidate;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!CANDIDATE_DISCOVERY_KEYS.has(key)) {
      continue;
    }

    const match = findFirstGroupInfo(nestedValue, depth + 1);
    if (match.id || match.url) {
      return match;
    }
  }

  return { id: null, url: null };
}

function findFirstGroupPostUrl(value, depth = 0) {
  if (depth > 10 || value == null) {
    return null;
  }

  if (typeof value === "string") {
    return extractPostInfoFromUrl(value)?.canonicalUrl ?? null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findFirstGroupPostUrl(item, depth + 1);
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
    value.url,
    value.story_url,
    value.permalink_url,
    value.wwwURL,
    value.override_url,
    value.video_override_url,
  ];

  for (const candidate of directCandidates) {
    const match = extractPostInfoFromUrl(candidate)?.canonicalUrl ?? null;
    if (match) {
      return match;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!CANDIDATE_DISCOVERY_KEYS.has(key)) {
      continue;
    }

    const match = findFirstGroupPostUrl(nestedValue, depth + 1);
    if (match) {
      return match;
    }
  }

  return null;
}

function recordDiagnostic(context, key, amount = 1) {
  if (!context?.diagnostics) {
    return;
  }

  context.diagnostics[key] = (context.diagnostics[key] ?? 0) + amount;
}

function looksLikeCommentNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return false;
  }

  const typename = typeof node.__typename === "string" ? node.__typename.toLowerCase() : "";
  if (typename.includes("comment")) {
    return true;
  }

  return (
    node.depth != null ||
    node.legacy_fbid != null ||
    node.parent_feedback != null ||
    node.parent_post_story != null ||
    node.comment_action_links != null ||
    node.comment_rendering_instance != null ||
    node.group_comment_info != null
  );
}

function hasStoryStructureSignals(node, directUrl, groupInfo) {
  const typename = typeof node.__typename === "string" ? node.__typename.toLowerCase() : "";
  if (typename && STORY_TYPENAME_HINTS.some((hint) => typename.includes(hint))) {
    return true;
  }

  return Boolean(
    directUrl ||
      hasRichStoryFields(node) ||
      groupInfo.url ||
      groupInfo.id ||
      node.to?.id ||
      node.group_id ||
      node.group_url ||
      node.post_id ||
      node.top_level_post_id ||
      node.story_fbid ||
      node.mf_story_key ||
      node.story_url ||
      node.permalink_url ||
      node.wwwURL
  );
}

function hasRichStoryFields(node) {
  return Boolean(
    node.feedback ||
      node.attachments ||
      node.comet_sections ||
      node.message ||
      node.preferred_body ||
      node.preferred_body_renderer ||
      node.body ||
      node.body_renderer ||
      node.story ||
      node.message_container ||
      node.shareable_from_perspective_of_feed_ufi ||
      Array.isArray(node.actors) ||
      typeof node.creation_time === "number" ||
      typeof node.publish_time === "number" ||
      typeof node.created_time === "number" ||
      node.target_group ||
      node.associated_group ||
      node.group ||
      node.to?.url
  );
}

function looksLikeShallowPluginNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return false;
  }

  const hasPostIdentifiers = Boolean(
    node.post_id || node.top_level_post_id || node.mf_story_key || node.story_fbid || node.group_id,
  );
  if (!hasPostIdentifiers) {
    return false;
  }

  const keys = Object.keys(node);
  if (!keys.length) {
    return false;
  }

  if (hasRichStoryFields(node) || node.url || node.story_url || node.permalink_url || node.wwwURL) {
    return false;
  }

  return keys.every(
    (key) =>
      SHALLOW_PLUGIN_KEYS.has(key) ||
      key.startsWith("__module_operation_") ||
      key.startsWith("__module_component_"),
  );
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

  if (looksLikeCommentNode(node)) {
    recordDiagnostic(context, "rejectedNoiseCandidates");
    return null;
  }

  const directUrl =
    getString(node.url) ??
    getString(node.story_url) ??
    getString(node.permalink_url) ??
    getString(node.wwwURL) ??
    findFirstGroupPostUrl(node);
  const tracking = parseTracking(node.tracking);
  const groupInfo = findFirstGroupInfo(node);
  if (looksLikeShallowPluginNode(node)) {
    recordDiagnostic(context, "rejectedNoiseCandidates");
    return null;
  }
  const trackedPostId = getString(tracking.top_level_post_id) ?? getString(tracking.mf_story_key);
  const postId =
    getString(node.post_id) ??
    getString(node.top_level_post_id) ??
    getString(node.story_fbid) ??
    getString(node.mf_story_key) ??
    trackedPostId;
  const postInfo = extractPostInfoFromUrl(directUrl);
  const stablePostId = postInfo?.postId ?? postId;
  const requestedGroupSlugOrId = extractGroupSlugOrId(context.groupUrl);
  const requestedNumericGroupId =
    requestedGroupSlugOrId && /^\d+$/.test(requestedGroupSlugOrId) ? requestedGroupSlugOrId : null;
  const effectiveGroupUrl =
    normalizeGroupUrl(node.groupUrl) ??
    (requestedNumericGroupId && groupInfo.id === requestedNumericGroupId
      ? context.groupUrl
      : normalizeGroupUrl(groupInfo.url)) ??
    (postInfo ? `https://www.facebook.com/groups/${postInfo.groupSlugOrId}/` : context.groupUrl);

  if (!stablePostId || !effectiveGroupUrl) {
    return null;
  }

  if (!hasStoryStructureSignals(node, directUrl, groupInfo)) {
    recordDiagnostic(context, "rejectedNoiseCandidates");
    return null;
  }

  const author = findActor(node);
  const createdAtRaw =
    typeof node.creation_time === "number"
      ? node.creation_time
      : typeof node.publish_time === "number"
        ? node.publish_time
        : typeof node.created_time === "number"
          ? node.created_time
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
        diagnostics: context.diagnostics,
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
        diagnostics: context.diagnostics,
      }),
    );
  }

  return uniqBy(collected, (item) => item.id || item.url);
}
