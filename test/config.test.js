import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config/load-config.js";

const ENV_KEYS = [
  "GROUP_URL",
  "MAX_POSTS",
  "RUNTIME_MINUTES",
  "PROXY_SERVER",
  "PROXY_USERNAME",
  "PROXY_PASSWORD",
  "PROXY_POOL_DIR",
  "PROXY_POOL_PROTOCOL",
  "PROXY_MAX_SESSIONS_PER_PROXY",
  "PROXY_ROTATE_ON_RETRY",
  "PROXY_ROTATE_ON_RECYCLE",
  "PROXY_ROTATE_ON_BLOCK",
  "HOME_WARMUP",
  "HOME_WARMUP_DELAY_MS",
  "MIN_DELAY_MS",
  "MAX_DELAY_MS",
  "NO_NEW_POST_CYCLES",
  "BROWSER_RECYCLE_REQUESTS",
  "HEADLESS",
  "PROXY_TEST_URL",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] == null) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

test("loadConfig uses .env defaults and lets CLI override them", async () => {
  const previousEnv = snapshotEnv();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-config-test-"));

  try {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    await fs.writeFile(
      path.join(tempDir, ".env"),
      [
        "GROUP_URL=https://www.facebook.com/groups/123456789012345/",
        "MAX_POSTS=55",
        "PROXY_SERVER=http://proxy.example:8080",
        "PROXY_POOL_DIR=proxy/socket5",
      ].join("\n"),
      "utf8",
    );

    const config = loadConfig(
      ["--url", "https://www.facebook.com/groups/override-group/", "--max-posts", "5"],
      tempDir,
    );

    assert.equal(config.groupUrl, "https://www.facebook.com/groups/override-group/");
    assert.equal(config.maxPosts, 5);
    assert.equal(config.proxy.server, "http://proxy.example:8080");
    assert.equal(config.proxyPoolDir, path.join(tempDir, "proxy", "socket5"));
    assert.ok(config.outputDir.endsWith(path.join("output", "result1")));
  } finally {
    restoreEnv(previousEnv);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig ignores OUTPUT_DIR from .env and uses auto-numbered result folders", async () => {
  const previousEnv = snapshotEnv();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-config-test-"));

  try {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    await fs.writeFile(
      path.join(tempDir, ".env"),
      ["GROUP_URL=https://www.facebook.com/groups/blank-output-group/", "OUTPUT_DIR=output/cov2"].join("\n"),
      "utf8",
    );

    await fs.mkdir(path.join(tempDir, "output", "result1"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "output", "result2"), { recursive: true });

    const config = loadConfig([], tempDir);
    assert.equal(config.outputDir, path.join(tempDir, "output", "result3"));
  } finally {
    restoreEnv(previousEnv);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig uses the latest auto-numbered result folder for resume runs", async () => {
  const previousEnv = snapshotEnv();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-config-test-"));

  try {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    await fs.writeFile(
      path.join(tempDir, ".env"),
      ["GROUP_URL=https://www.facebook.com/groups/resume-group/"].join("\n"),
      "utf8",
    );

    await fs.mkdir(path.join(tempDir, "output", "result2"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "output", "result5"), { recursive: true });

    const config = loadConfig(["--resume"], tempDir);
    assert.equal(config.outputDir, path.join(tempDir, "output", "result5"));
  } finally {
    restoreEnv(previousEnv);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig disables static proxy and proxy pool when --no-proxy is passed", async () => {
  const previousEnv = snapshotEnv();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-config-test-"));

  try {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    await fs.writeFile(
      path.join(tempDir, ".env"),
      [
        "GROUP_URL=https://www.facebook.com/groups/no-proxy-group/",
        "PROXY_SERVER=http://proxy.example:8080",
        "PROXY_POOL_DIR=proxy/socket5",
      ].join("\n"),
      "utf8",
    );

    const config = loadConfig(["--no-proxy"], tempDir);
    assert.equal(config.noProxy, true);
    assert.equal(config.proxy, null);
    assert.equal(config.proxyPoolDir, null);
  } finally {
    restoreEnv(previousEnv);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
