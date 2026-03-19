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
  "SCHEDULE_TOTAL_MINUTES",
  "SCHEDULE_INTERVAL_MINUTES",
  "SCHEDULE_RUN_ANALYZER",
  "SESSION_STATE_ENABLED",
  "SESSION_STATE_DIR",
  "SESSION_STATE_TTL_HOURS",
  "SESSION_STATE_MIN_POSTS_TO_SAVE",
  "SESSION_STATE_RESET_ON_BLOCK",
  "PROXY_SERVER",
  "PROXY_USERNAME",
  "PROXY_PASSWORD",
  "PROXY_POOL_DIR",
  "PROXY_POOL_PROTOCOL",
  "PROXY_MAX_SESSIONS_PER_PROXY",
  "PROXY_QUARANTINE_MINUTES",
  "PROXY_FAILURE_SCORE_THRESHOLD",
  "PROXY_LOW_YIELD_POST_THRESHOLD",
  "PROXY_ROTATE_ON_RETRY",
  "PROXY_ROTATE_ON_RECYCLE",
  "PROXY_ROTATE_ON_BLOCK",
  "HOME_WARMUP",
  "HOME_WARMUP_DELAY_MS",
  "MIN_DELAY_MS",
  "MAX_DELAY_MS",
  "NO_NEW_POST_CYCLES",
  "NETWORK_STALL_RECYCLE_CYCLES",
  "MAX_NETWORK_STALL_RESTARTS",
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
    assert.equal(config.resume, true);
    assert.ok(config.outputDir.endsWith(path.join("output", "result")));
    assert.ok(config.sessionStateDir.endsWith(path.join("output", "result", "session-state")));
  } finally {
    restoreEnv(previousEnv);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig ignores OUTPUT_DIR from .env and uses the cumulative output/result folder", async () => {
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

    const config = loadConfig([], tempDir);
    assert.equal(config.outputDir, path.join(tempDir, "output", "result"));
  } finally {
    restoreEnv(previousEnv);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig uses the cumulative output/result folder for resume runs", async () => {
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

    const config = loadConfig(["--resume"], tempDir);
    assert.equal(config.outputDir, path.join(tempDir, "output", "result"));
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

test("loadConfig enables scheduled mode from env", async () => {
  const previousEnv = snapshotEnv();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-config-test-"));

  try {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    await fs.writeFile(
      path.join(tempDir, ".env"),
      [
        "GROUP_URL=https://www.facebook.com/groups/scheduled-group/",
        "SCHEDULE_TOTAL_MINUTES=120",
        "SCHEDULE_INTERVAL_MINUTES=15",
        "SCHEDULE_RUN_ANALYZER=true",
      ].join("\n"),
      "utf8",
    );

    const config = loadConfig([], tempDir);
    assert.equal(config.scheduleTotalMinutes, 120);
    assert.equal(config.scheduleIntervalMinutes, 15);
    assert.equal(config.scheduleRunAnalyzer, true);
  } finally {
    restoreEnv(previousEnv);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
