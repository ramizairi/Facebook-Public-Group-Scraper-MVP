import assert from "node:assert/strict";
import test from "node:test";

import { isRetriableProxyError } from "../src/browser/proxy-errors.js";

test("isRetriableProxyError matches tunnel and proxy connection failures", () => {
  assert.equal(
    isRetriableProxyError(
      new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://www.facebook.com/'),
    ),
    true,
  );

  assert.equal(
    isRetriableProxyError(
      new Error("browserType.launch: Browser does not support socks5 proxy authentication"),
    ),
    true,
  );

  assert.equal(
    isRetriableProxyError(new Error('page.goto: net::ERR_ABORTED at https://www.facebook.com/')),
    true,
  );
});

test("isRetriableProxyError ignores unrelated application errors", () => {
  assert.equal(isRetriableProxyError(new Error("Unexpected token < in JSON at position 0")), false);
});
