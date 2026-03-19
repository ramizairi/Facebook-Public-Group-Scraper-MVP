import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionStateStore } from "../src/browser/session-state.js";

const logger = {
  info() {},
  warn() {},
};

function createFakeContext(payload) {
  return {
    async storageState({ path: filePath }) {
      await fs.writeFile(filePath, JSON.stringify(payload), "utf8");
    },
  };
}

test("session state store saves and loads per-proxy state", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-session-state-test-"));

  try {
    const store = new SessionStateStore(
      tempDir,
      {
        enabled: true,
        ttlHours: 72,
        minPostsToSave: 1,
        resetOnBlock: true,
      },
      logger,
    );

    const proxy = {
      server: "http://gate.example:10001",
      username: "user-a",
      password: "secret",
    };

    await store.save(createFakeContext({ cookies: [{ name: "datr" }] }), proxy, {
      posts: 3,
      reason: "accepted-posts",
      bootstrapped: true,
    });

    const loaded = await store.load(proxy);
    assert.ok(loaded);
    assert.equal(loaded.meta.posts, 3);
    assert.equal(loaded.meta.reason, "accepted-posts");

    const rawState = JSON.parse(await fs.readFile(loaded.statePath, "utf8"));
    assert.deepEqual(rawState, { cookies: [{ name: "datr" }] });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("session state store clears proxy-bound state on demand", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-session-state-test-"));

  try {
    const store = new SessionStateStore(
      tempDir,
      {
        enabled: true,
        ttlHours: 72,
        minPostsToSave: 1,
        resetOnBlock: true,
      },
      logger,
    );

    const proxy = {
      server: "http://gate.example:10002",
      username: "user-b",
      password: "secret",
    };

    await store.save(createFakeContext({ cookies: [{ name: "fr" }] }), proxy, {
      posts: 5,
      reason: "bootstrap-accepted-posts",
      bootstrapped: true,
    });

    assert.ok(await store.load(proxy));
    await store.clear(proxy, "redirected-to-login");
    assert.equal(await store.load(proxy), null);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
