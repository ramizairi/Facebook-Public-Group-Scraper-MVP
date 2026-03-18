function redactUserInfo(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? "***" : "";
      parsed.password = parsed.password ? "***" : "";
    }

    return parsed.toString();
  } catch {
    return value.replace(/\/\/([^:@/]+)(?::[^@/]+)?@/, "//***:***@");
  }
}

export function redactProxyConfig(proxy) {
  if (!proxy?.server) {
    return null;
  }

  return {
    server: redactUserInfo(proxy.server),
    username: proxy.username ? "***" : undefined,
    password: proxy.password ? "***" : undefined,
  };
}

export function sanitizeConfigForLog(config) {
  const sanitized = {
    ...config,
    proxy: redactProxyConfig(config.proxy),
  };

  return sanitized;
}
