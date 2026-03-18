import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCheckpoint, loadCheckpoint, persistCheckpoint } from "../src/core/checkpoint.js";
import { DedupStore } from "../src/core/dedup-store.js";
import { normalizeCandidate } from "../src/core/normalize.js";
import { extractDomPosts } from "../src/extract/dom-fallback.js";
import { sameGroupUrl } from "../src/utils/facebook-url.js";
import { redactProxyConfig, summarizeProxyForConsole } from "../src/utils/redact.js";

test("redactProxyConfig hides credentials", () => {
  const redacted = redactProxyConfig({
    server: "http://user:pass@proxy.example:8080",
    username: "user",
    password: "pass",
  });

  assert.equal(redacted.server, "http://***:***@proxy.example:8080/");
  assert.equal(redacted.username, "***");
  assert.equal(redacted.password, "***");
});

test("summarizeProxyForConsole shows proxy host without credentials", () => {
  const summary = summarizeProxyForConsole({
    server: "http://user:pass@proxy.example:8080",
    username: "user",
    password: "pass",
  });

  assert.equal(summary, "http://proxy.example:8080");
});

test("normalizeCandidate plus DedupStore deduplicates stable posts", () => {
  const first = normalizeCandidate(
    {
      id: "444444444444444",
      url: "https://www.facebook.com/groups/123456789012345/posts/444444444444444/?__tn__=R",
      groupUrl: "https://www.facebook.com/groups/123456789012345/",
      text: "Hello world",
      sourceType: "network",
      media: [],
      rawFragment: null,
    },
    "https://www.facebook.com/groups/123456789012345/",
  );

  const second = normalizeCandidate(
    {
      id: "444444444444444",
      url: "https://www.facebook.com/groups/123456789012345/permalink/444444444444444/",
      groupUrl: "https://www.facebook.com/groups/123456789012345/",
      text: "Hello world",
      sourceType: "dom",
      media: [],
      rawFragment: null,
    },
    "https://www.facebook.com/groups/123456789012345/",
  );

  const dedup = new DedupStore();
  assert.equal(dedup.has(first), false);
  dedup.add(first);
  assert.equal(dedup.has(second), true);
});

test("normalizeCandidate drops shell posts with no useful non-null fields", () => {
  const normalized = normalizeCandidate(
    {
      id: "1471855064391020",
      url: "https://www.facebook.com/groups/525468629029673/posts/1471855064391020/",
      groupUrl: "https://www.facebook.com/groups/525468629029673/",
      authorName: null,
      authorId: null,
      createdAt: null,
      text: null,
      media: [],
      reactionCount: null,
      commentCount: null,
      shareCount: null,
      sourceType: "network",
      rawFragment: {
        source: "document-embedded-json",
        reference: "1471855064391020:document-embedded-json",
      },
    },
    "https://www.facebook.com/groups/525468629029673/",
  );

  assert.equal(normalized, null);
});

test("normalizeCandidate can keep shell posts in unfiltered mode", () => {
  const normalized = normalizeCandidate(
    {
      id: "1471855064391020",
      url: "https://www.facebook.com/groups/525468629029673/posts/1471855064391020/",
      groupUrl: "https://www.facebook.com/groups/525468629029673/",
      authorName: null,
      authorId: null,
      createdAt: null,
      text: null,
      media: [],
      reactionCount: null,
      commentCount: null,
      shareCount: null,
      sourceType: "network",
      rawFragment: {
        source: "document-embedded-json",
        reference: "1471855064391020:document-embedded-json",
      },
    },
    "https://www.facebook.com/groups/525468629029673/",
    { allowShellPosts: true },
  );

  assert.equal(normalized?.id, "1471855064391020");
  assert.equal(normalized?.text, null);
});

test("checkpoint persistence round-trips posts and stats", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-checkpoint-test-"));

  try {
    const checkpoint = buildCheckpoint({
      config: {
        groupUrl: "https://www.facebook.com/groups/123456789012345/",
        outputDir: tempDir,
      },
      posts: [
        {
          id: "1",
          url: "https://www.facebook.com/groups/123456789012345/posts/1/",
          groupUrl: "https://www.facebook.com/groups/123456789012345/",
          authorName: null,
          authorId: null,
          createdAt: null,
          text: "Checkpoint post",
          media: [],
          reactionCount: null,
          commentCount: null,
          shareCount: null,
          sourceType: "network",
          rawFragment: null,
        },
      ],
      unfilteredPosts: [
        {
          id: "2",
          url: "https://www.facebook.com/groups/123456789012345/posts/2/",
          groupUrl: "https://www.facebook.com/groups/123456789012345/",
          authorName: null,
          authorId: null,
          createdAt: null,
          text: null,
          media: [],
          reactionCount: null,
          commentCount: null,
          shareCount: null,
          sourceType: "network",
          rawFragment: null,
        },
      ],
      stats: {
        uniquePosts: 1,
      },
    });

    await persistCheckpoint(tempDir, checkpoint);
    const loaded = await loadCheckpoint(tempDir);
    assert.equal(loaded.posts.length, 1);
    assert.equal(loaded.unfilteredPosts.length, 1);
    assert.equal(loaded.stats.uniquePosts, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("sameGroupUrl matches canonical group urls and rejects different groups", () => {
  assert.equal(
    sameGroupUrl(
      "https://facebook.com/groups/123456789012345/?ref=share",
      "https://www.facebook.com/groups/123456789012345/",
    ),
    true,
  );

  assert.equal(
    sameGroupUrl(
      "https://www.facebook.com/groups/123456789012345/",
      "https://www.facebook.com/groups/364609516924296/",
    ),
    false,
  );
});

test("extractDomPosts falls back to preview text when dir-auto blocks are thin", async () => {
  const page = {
    evaluate: async (fn, arg) =>
      fn({
        currentGroupSlugOrId: arg.currentGroupSlugOrId,
      }),
  };

  page.evaluate = async (_fn, arg) => [
    {
      index: 0,
      url: `https://www.facebook.com/groups/${arg.currentGroupSlugOrId}/posts/123456789012345/`,
      authorName: "Ahmed Juriste",
      textBlocks: ["Ahmed Juriste", "23m"],
      media: [],
      reactionCount: null,
      preview:
        "Ahmed Juriste 23m Shared with Public group 3 places disponibles demain matin de Tunis vers sousse 8h Like Comment Share",
    },
  ];

  const posts = await extractDomPosts(page, {
    groupUrl: "https://www.facebook.com/groups/525468629029673/",
  });

  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /3 places disponibles demain matin de Tunis vers sousse 8h/i);
});
