import { normalizeCandidate } from "./normalize.js";
import { extractPostInfoFromUrl } from "../utils/facebook-url.js";

function postIdentity(post) {
  const postInfo = extractPostInfoFromUrl(post?.url);
  return {
    id: post?.id ?? postInfo?.postId ?? null,
    url: postInfo?.canonicalUrl ?? post?.url ?? null,
  };
}

function samePostIdentity(left, right) {
  const leftIdentity = postIdentity(left);
  const rightIdentity = postIdentity(right);

  if (leftIdentity.id && rightIdentity.id) {
    return leftIdentity.id === rightIdentity.id;
  }

  if (leftIdentity.url && rightIdentity.url) {
    return leftIdentity.url === rightIdentity.url;
  }

  return false;
}

function scoreEnrichmentCandidate(candidate) {
  let score = 0;
  if (candidate.text) {
    score += 8;
  }

  if (candidate.authorName) {
    score += 2;
  }

  if (candidate.authorId) {
    score += 1;
  }

  if (candidate.createdAt) {
    score += 2;
  }

  if (Array.isArray(candidate.media) && candidate.media.length > 0) {
    score += 1;
  }

  return score;
}

export function needsTextEnrichment(post) {
  return !post?.text;
}

export function selectBestEnrichmentCandidate(candidates, targetPost, groupUrl) {
  const normalizedMatches = [];

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const normalized = normalizeCandidate(candidate, groupUrl, {
      allowShellPosts: true,
    });

    if (!normalized || !samePostIdentity(normalized, targetPost)) {
      continue;
    }

    normalizedMatches.push(normalized);
  }

  normalizedMatches.sort((left, right) => scoreEnrichmentCandidate(right) - scoreEnrichmentCandidate(left));
  return normalizedMatches[0] ?? null;
}

export function mergeEnrichedPost(targetPost, enrichedPost) {
  if (!targetPost || !enrichedPost || !samePostIdentity(targetPost, enrichedPost)) {
    return false;
  }

  let changed = false;

  const maybeAssign = (key) => {
    const currentValue = targetPost[key];
    const nextValue = enrichedPost[key];

    if (Array.isArray(currentValue)) {
      if (currentValue.length === 0 && Array.isArray(nextValue) && nextValue.length > 0) {
        targetPost[key] = nextValue;
        changed = true;
      }

      return;
    }

    if ((currentValue == null || currentValue === "") && nextValue != null && nextValue !== "") {
      targetPost[key] = nextValue;
      changed = true;
    }
  };

  maybeAssign("text");
  maybeAssign("authorName");
  maybeAssign("authorId");
  maybeAssign("createdAt");
  maybeAssign("media");

  if (changed) {
    targetPost.rawFragment = {
      ...(targetPost.rawFragment ?? {}),
      enrichedFrom: enrichedPost.rawFragment?.source ?? "post-enrichment",
      enrichedReference: enrichedPost.rawFragment?.reference ?? null,
      textPreview:
        targetPost.rawFragment?.textPreview ??
        enrichedPost.rawFragment?.textPreview ??
        (typeof enrichedPost.text === "string" ? enrichedPost.text.slice(0, 240) : undefined),
    };
  }

  return changed;
}
