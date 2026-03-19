const RETRIABLE_PROXY_ERROR_PATTERNS = [
  /ERR_TUNNEL_CONNECTION_FAILED/i,
  /ERR_ABORTED/i,
  /ERR_PROXY_CONNECTION_FAILED/i,
  /ERR_NO_SUPPORTED_PROXIES/i,
  /ERR_SOCKS_CONNECTION_FAILED/i,
  /ERR_CONNECTION_(?:CLOSED|RESET|TIMED_OUT|REFUSED|FAILED)/i,
  /Proxy CONNECT aborted/i,
  /Browser does not support socks5 proxy authentication/i,
  /\bECONNREFUSED\b/i,
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
  /\bEHOSTUNREACH\b/i,
  /\bENETUNREACH\b/i,
  /socket hang up/i,
];

export function isRetriableProxyError(error) {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error);

  return RETRIABLE_PROXY_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
