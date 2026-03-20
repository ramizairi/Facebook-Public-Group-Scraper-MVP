import fs from "node:fs/promises";

function normalizeSameSite(value) {
  if (typeof value !== "string" || !value.length) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (normalized === "lax") {
    return "Lax";
  }

  if (normalized === "strict") {
    return "Strict";
  }

  if (normalized === "none") {
    return "None";
  }

  return undefined;
}

function normalizeCookie(cookie) {
  if (!cookie || typeof cookie !== "object") {
    return null;
  }

  const name = typeof cookie.name === "string" ? cookie.name : null;
  const value = typeof cookie.value === "string" ? cookie.value : null;
  const url = typeof cookie.url === "string" && cookie.url ? cookie.url : undefined;
  const domain = typeof cookie.domain === "string" && cookie.domain ? cookie.domain : undefined;
  const path = typeof cookie.path === "string" && cookie.path ? cookie.path : "/";

  if (!name || value == null) {
    return null;
  }

  const expiresCandidate =
    typeof cookie.expires === "number"
      ? cookie.expires
      : typeof cookie.expirationDate === "number"
        ? cookie.expirationDate
        : undefined;
  const expires =
    typeof expiresCandidate === "number" && Number.isFinite(expiresCandidate) && expiresCandidate > 0
      ? expiresCandidate
      : undefined;

  const normalized = {
    name,
    value,
    path,
    httpOnly: cookie.httpOnly === true,
    secure: cookie.secure === true,
    sameSite: normalizeSameSite(cookie.sameSite),
    ...(expires ? { expires } : {}),
  };

  if (url) {
    return {
      ...normalized,
      url,
    };
  }

  return {
    ...normalized,
    domain: domain ?? ".facebook.com",
  };
}

export async function loadCookiesFromFile(filePath, logger) {
  if (!filePath) {
    return [];
  }

  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const sourceCookies = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.cookies)
      ? parsed.cookies
      : null;

  if (!sourceCookies) {
    throw new Error(
      `Unsupported cookies file format in ${filePath}. Expected a JSON array or an object with a cookies array.`,
    );
  }

  const cookies = sourceCookies.map((cookie) => normalizeCookie(cookie)).filter(Boolean);
  logger.info({
    event: "cookies-file-loaded",
    filePath,
    cookieCount: cookies.length,
  });

  return cookies;
}
