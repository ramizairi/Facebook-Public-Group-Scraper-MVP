import { z } from "zod";

import { extractPostInfoFromUrl, normalizeGroupUrl, normalizePostUrl } from "../utils/facebook-url.js";

const MediaItemSchema = z.object({
  type: z.enum(["image", "video", "unknown"]).catch("unknown"),
  url: z.string().url(),
});

const RawFragmentSchema = z
  .object({
    source: z.string(),
    reference: z.string().nullable().optional(),
    sourceUrl: z.string().nullable().optional(),
    keys: z.array(z.string()).optional(),
    textPreview: z.string().optional(),
  })
  .passthrough();

export const NormalizedPostSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  groupUrl: z.string().url(),
  authorName: z.string().nullable(),
  authorId: z.string().nullable(),
  createdAt: z.string().nullable(),
  text: z.string().nullable(),
  media: z.array(MediaItemSchema),
  reactionCount: z.number().int().nonnegative().nullable(),
  commentCount: z.number().int().nonnegative().nullable(),
  shareCount: z.number().int().nonnegative().nullable(),
  sourceType: z.enum(["network", "dom"]),
  rawFragment: RawFragmentSchema.nullable(),
});

function normalizeCount(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length ? normalized : null;
}

function normalizeMedia(media) {
  if (!Array.isArray(media)) {
    return [];
  }

  const deduped = [];
  const seen = new Set();

  for (const item of media) {
    if (!item?.url) {
      continue;
    }

    const key = `${item.type ?? "unknown"}:${item.url}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      type: item.type === "video" ? "video" : item.type === "image" ? "image" : "unknown",
      url: item.url,
    });
  }

  return deduped;
}

export function normalizeCandidate(candidate, defaultGroupUrl) {
  const normalizedUrl = normalizePostUrl(candidate.url) ?? null;
  const postInfo = extractPostInfoFromUrl(normalizedUrl ?? candidate.url);
  const stableId = String(candidate.id ?? postInfo?.postId ?? "").trim();
  const groupUrl =
    normalizeGroupUrl(candidate.groupUrl) ??
    (postInfo ? `https://www.facebook.com/groups/${postInfo.groupSlugOrId}/` : normalizeGroupUrl(defaultGroupUrl));

  if (!stableId || !groupUrl) {
    return null;
  }

  const payload = {
    id: stableId,
    url: normalizedUrl ?? `${groupUrl}posts/${stableId}/`,
    groupUrl,
    authorName: normalizeText(candidate.authorName),
    authorId: candidate.authorId ? String(candidate.authorId) : null,
    createdAt: typeof candidate.createdAt === "string" && candidate.createdAt ? candidate.createdAt : null,
    text: normalizeText(candidate.text),
    media: normalizeMedia(candidate.media),
    reactionCount: normalizeCount(candidate.reactionCount),
    commentCount: normalizeCount(candidate.commentCount),
    shareCount: normalizeCount(candidate.shareCount),
    sourceType: candidate.sourceType === "dom" ? "dom" : "network",
    rawFragment: candidate.rawFragment ?? null,
  };

  const result = NormalizedPostSchema.safeParse(payload);
  return result.success ? result.data : null;
}
