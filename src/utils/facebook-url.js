const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);
const GROUP_POST_PATH_REGEX = /^\/groups\/([^/]+)\/(posts|permalink)\/(\d+)(?:\/|$)/i;

function normalizeHost(hostname) {
  return FACEBOOK_HOSTS.has(hostname) ? "www.facebook.com" : hostname;
}

export function canonicalizeUrl(input) {
  if (!input) {
    return null;
  }

  try {
    const url = new URL(input);
    url.hash = "";
    url.search = "";
    url.hostname = normalizeHost(url.hostname);
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeGroupUrl(input) {
  const url = canonicalizeUrl(input);
  if (!url) {
    return null;
  }

  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/groups\/([^/]+)(?:\/|$)/i);
  if (!match) {
    return null;
  }

  parsed.pathname = `/groups/${match[1]}/`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function extractGroupSlugOrId(input) {
  const normalized = normalizeGroupUrl(input);
  if (!normalized) {
    return null;
  }

  return new URL(normalized).pathname.split("/").filter(Boolean)[1] ?? null;
}

export function isNumericGroupIdentifier(value) {
  return typeof value === "string" && /^\d+$/.test(value.trim());
}

export function extractPostInfoFromUrl(input) {
  const url = canonicalizeUrl(input);
  if (!url) {
    return null;
  }

  const parsed = new URL(url);
  const match = parsed.pathname.match(GROUP_POST_PATH_REGEX);
  if (!match) {
    return null;
  }

  return {
    canonicalUrl: `${parsed.origin}/groups/${match[1]}/${match[2]}/${match[3]}/`,
    groupSlugOrId: match[1],
    routeType: match[2],
    postId: match[3],
  };
}

export function normalizePostUrl(input) {
  return extractPostInfoFromUrl(input)?.canonicalUrl ?? null;
}

export function looksLikeGroupPostUrl(input, currentGroupSlugOrId = null) {
  const postInfo = extractPostInfoFromUrl(input);
  if (!postInfo) {
    return false;
  }

  if (!currentGroupSlugOrId) {
    return true;
  }

  const expected = String(currentGroupSlugOrId).trim().toLowerCase();
  const actual = String(postInfo.groupSlugOrId).trim().toLowerCase();
  if (!expected || !actual) {
    return true;
  }

  if (expected === actual) {
    return true;
  }

  return isNumericGroupIdentifier(expected) || isNumericGroupIdentifier(actual);
}

export function sameGroupUrl(left, right) {
  const normalizedLeft = normalizeGroupUrl(left);
  const normalizedRight = normalizeGroupUrl(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft === normalizedRight;
}

export function deriveOutputSlug(groupUrl) {
  const slug = extractGroupSlugOrId(groupUrl) ?? "default-group";
  return slug.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "default-group";
}
