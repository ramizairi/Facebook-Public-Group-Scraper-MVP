import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildProxyUrl } from "../src/browser/proxy-bridge.js";
import { ProxyPool, normalizeProxyConfig, parseProxyLine } from "../src/browser/proxy-pool.js";

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

test("parseProxyLine supports username:password@host:port format", () => {
  const proxy = parseProxyLine("ebywkquq:4d37d73jym2m@31.59.20.176:6754", "http");

  assert.deepEqual(proxy, {
    server: "http://31.59.20.176:6754",
    username: "ebywkquq",
    password: "4d37d73jym2m",
  });
});

test("parseProxyLine supports host,port,username,password format", () => {
  const proxy = parseProxyLine("brd.superproxy.io,33335,customer,password", "http");

  assert.deepEqual(proxy, {
    server: "http://brd.superproxy.io:33335",
    username: "customer",
    password: "password",
  });
});

test("buildProxyUrl converts proxy objects to browser-safe upstream URLs", () => {
  const url = buildProxyUrl({
    server: "socks5://31.59.20.176:6754",
    username: "ebywkquq",
    password: "4d37d73jym2m",
  });

  assert.equal(url, "socks5://ebywkquq:4d37d73jym2m@31.59.20.176:6754");
});

test("normalizeProxyConfig adds a default protocol to static proxy settings", () => {
  const proxy = normalizeProxyConfig(
    {
      server: "brd.superproxy.io:33335",
      username: "customer",
      password: "password",
    },
    "http",
  );

  assert.deepEqual(proxy, {
    server: "http://brd.superproxy.io:33335",
    username: "customer",
    password: "password",
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

test("proxy pool quarantines login-wall proxies and skips them on the next rotation", async () => {
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
        proxyPoolProtocol: "http",
        proxyMaxSessionsPerProxy: 5,
        proxyQuarantineMinutes: 30,
        proxyFailureScoreThreshold: 3,
        proxyLowYieldPostThreshold: 3,
      },
      logger,
    );

    const first = pool.acquire({ reason: "initial" });
    pool.reportFailure(first, { reason: "redirected-to-login" });

    const second = pool.acquire({ reason: "startup-retry", forceRotate: true });

    assert.equal(first.server, "http://1.1.1.1:1000");
    assert.equal(second.server, "http://2.2.2.2:2000");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("proxy pool keeps the current proxy when it is the only healthy option left", async () => {
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
        proxyPoolProtocol: "http",
        proxyMaxSessionsPerProxy: 1,
        proxyQuarantineMinutes: 30,
        proxyFailureScoreThreshold: 3,
        proxyLowYieldPostThreshold: 3,
      },
      logger,
    );

    const first = pool.acquire({ reason: "initial" });
    const second = pool.acquire({ reason: "startup-retry", forceRotate: true });
    pool.reportFailure(first, { reason: "proxy-error" });

    const fallback = pool.acquire({ reason: "network-stall", forceRotate: true });

    assert.equal(second.server, "http://2.2.2.2:2000");
    assert.equal(fallback.server, "http://2.2.2.2:2000");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
