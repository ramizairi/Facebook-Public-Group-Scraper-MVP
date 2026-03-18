import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ProxyPool, parseProxyLine } from "../src/browser/proxy-pool.js";

const logger = {
  info() {},
  warn() {},
};

test("parseProxyLine supports host:port:user:password format", () => {
  const proxy = parseProxyLine("31.59.20.176:6754:ebywkquq:4d37d73jym2m");

  assert.deepEqual(proxy, {
    server: "socks5://31.59.20.176:6754",
    username: "ebywkquq",
    password: "4d37d73jym2m",
  });
});

test("proxy pool rotates across proxies on forced session changes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-proxy-pool-test-"));

  try {
    await fs.writeFile(
      path.join(tempDir, "pool.txt"),
      ["1.1.1.1:1000:user-a:pass-a", "2.2.2.2:2000:user-b:pass-b"].join("\n"),
      "utf8",
    );

    const pool = await ProxyPool.create(
      {
        proxyPoolDir: tempDir,
        proxyPoolProtocol: "socks5",
        proxyMaxSessionsPerProxy: 1,
      },
      logger,
    );

    assert.ok(pool);
    assert.equal(pool.hasProxies(), true);

    const first = pool.acquire({ reason: "initial" });
    const second = pool.acquire({ reason: "startup-retry", forceRotate: true });

    assert.equal(first.server, "socks5://1.1.1.1:1000");
    assert.equal(second.server, "socks5://2.2.2.2:2000");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
