const DEFAULT_API_HOST = "0.0.0.0";
const DEFAULT_API_PORT = 3000;

function resolveApiPort(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_API_PORT;
}

function requireNonEmptyString(name, value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  throw new Error(`${name} is required.`);
}

function normalizeOrigin(name, value) {
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid http(s) origin.`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https.`);
  }

  return parsed.origin;
}

export function loadApiServerConfig(env = process.env) {
  return {
    host: typeof env.API_HOST === "string" && env.API_HOST.trim() ? env.API_HOST.trim() : DEFAULT_API_HOST,
    port: resolveApiPort(env.API_PORT),
    authKey: requireNonEmptyString("API_AUTH_KEY", env.API_AUTH_KEY),
    allowedOrigin: normalizeOrigin(
      "API_ALLOWED_ORIGIN",
      requireNonEmptyString("API_ALLOWED_ORIGIN", env.API_ALLOWED_ORIGIN),
    ),
  };
}

