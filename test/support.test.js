import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCheckpoint, loadCheckpoint, persistCheckpoint } from "../src/core/checkpoint.js";
import { DedupStore } from "../src/core/dedup-store.js";
import { normalizeCandidate } from "../src/core/normalize.js";
import { mergeEnrichedPost, selectBestEnrichmentCandidate } from "../src/core/post-enrichment.js";
import { shouldRecycleBrowser, shouldRecycleOnNetworkStall } from "../src/core/run-scraper.js";
import {
  extractDomPosts,
  shouldClickDomLoadMoreControl,
  shouldClickDomTextExpanderControl,
} from "../src/extract/dom-fallback.js";
import { OutputManager } from "../src/output/manager.js";
import { toOutputRow } from "../src/output/output-row.js";
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

test("enrichment merges missing text into an existing accepted post without changing identity", () => {
  const targetPost = normalizeCandidate(
    {
      id: "26097131639978760",
      url: "https://www.facebook.com/groups/mauvaisplantunisieofficiel/permalink/26097131639978760/",
      groupUrl: "https://www.facebook.com/groups/3024678207650763/",
      authorName: null,
      createdAt: null,
      text: null,
      media: [],
      sourceType: "network",
      rawFragment: {
        source: "graphql",
        reference: "candidate-1",
      },
    },
    "https://www.facebook.com/groups/3024678207650763/",
    { allowShellPosts: true },
  );

  const selected = selectBestEnrichmentCandidate(
    [
      {
        id: "26097131639978760",
        url: "https://www.facebook.com/groups/mauvaisplantunisieofficiel/permalink/26097131639978760/",
        groupUrl: "https://www.facebook.com/groups/3024678207650763/",
        text: "Deep post text recovered from enrichment.",
        authorName: "Ivan Alvarez",
        createdAt: "2026-03-22T12:00:00.000Z",
        media: [],
        sourceType: "dom",
        rawFragment: {
          source: "dom-fallback",
          reference: "dom:26097131639978760",
        },
      },
    ],
    targetPost,
    "https://www.facebook.com/groups/3024678207650763/",
  );

  assert.ok(selected);
  assert.equal(mergeEnrichedPost(targetPost, selected), true);
  assert.equal(targetPost.id, "26097131639978760");
  assert.equal(targetPost.text, "Deep post text recovered from enrichment.");
  assert.equal(targetPost.authorName, "Ivan Alvarez");
  assert.equal(targetPost.rawFragment?.enrichedFrom, "dom-fallback");
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

test("output manager rewrites JSON outputs from the current normalized post list", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-output-manager-test-"));

  try {
    const outputManager = await OutputManager.create(tempDir);
    const initialPosts = [
      normalizeCandidate(
        {
          id: "1",
          url: "https://www.facebook.com/groups/123456789012345/posts/1/",
          groupUrl: "https://www.facebook.com/groups/123456789012345/",
          text: "First post",
          media: [],
          sourceType: "network",
          rawFragment: null,
        },
        "https://www.facebook.com/groups/123456789012345/",
      ),
      normalizeCandidate(
        {
          id: "2",
          url: "https://www.facebook.com/groups/123456789012345/posts/2/",
          groupUrl: "https://www.facebook.com/groups/123456789012345/",
          text: "Second post",
          media: [],
          sourceType: "network",
          rawFragment: null,
        },
        "https://www.facebook.com/groups/123456789012345/",
      ),
    ];

    await outputManager.resetPosts(initialPosts);
    await outputManager.appendPosts(initialPosts);
    await outputManager.writePostsJson(initialPosts.slice(0, 1));

    const postsJson = JSON.parse(await fs.readFile(path.join(tempDir, "posts.json"), "utf8"));
    const postsJsonl = (await fs.readFile(path.join(tempDir, "posts.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const outputJson = JSON.parse(await fs.readFile(path.join(tempDir, "output.json"), "utf8"));

    assert.equal(postsJson.length, 1);
    assert.equal(postsJsonl.length, 1);
    assert.equal(outputJson.length, 1);
    assert.equal(postsJson[0].id, "1");
    assert.equal(postsJsonl[0].id, "1");
    assert.equal(outputJson[0].url, "https://www.facebook.com/groups/123456789012345/posts/1/");
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

test("extractDomPosts accepts vanity-slug post urls when the current group url is numeric", async () => {
  const page = {
    evaluate: async () => [
      {
        index: 0,
        url: "https://www.facebook.com/groups/mauvaisplantunisieofficiel/permalink/26097131639978760/",
        authorName: "Ivan Alvarez",
        textBlocks: ["Ivan Alvarez", "Public group post carried by a vanity slug URL."],
        media: [],
        reactionCount: null,
        preview: "Ivan Alvarez Public group post carried by a vanity slug URL.",
      },
    ],
  };

  const posts = await extractDomPosts(page, {
    groupUrl: "https://www.facebook.com/groups/3024678207650763/",
  });

  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://www.facebook.com/groups/mauvaisplantunisieofficiel/permalink/26097131639978760/");
  assert.equal(posts[0].groupUrl, "https://www.facebook.com/groups/3024678207650763/");
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

test("toOutputRow keeps only the requested public export fields", () => {
  assert.deepEqual(
    toOutputRow({
      url: "https://www.facebook.com/groups/1/posts/2/",
      groupUrl: "https://www.facebook.com/groups/1/",
      authorName: "Test User",
      createdAt: "2026-03-20T12:00:00.000Z",
      text: "Hello world",
      reactionCount: 5,
      commentCount: 2,
      shareCount: 1,
      sourceType: "network",
      rawFragment: { ignored: true },
    }),
    {
      url: "https://www.facebook.com/groups/1/posts/2/",
      group_url: "https://www.facebook.com/groups/1/",
      author_name: "Test User",
      created_at: "2026-03-20T12:00:00.000Z",
      text: "Hello world",
      reaction_count: 5,
      comment_count: 2,
      share_count: 1,
    },
  );
});

test("dom load-more safety avoids clicking post-like controls inside articles", () => {
  assert.equal(
    shouldClickDomLoadMoreControl({
      label: "View more posts",
      insideAnchor: false,
      insideArticleWithTopLevelPermalink: false,
    }),
    true,
  );

  assert.equal(
    shouldClickDomLoadMoreControl({
      label: "View more",
      insideAnchor: true,
      insideArticleWithTopLevelPermalink: false,
    }),
    false,
  );

  assert.equal(
    shouldClickDomLoadMoreControl({
      label: "Show more",
      insideAnchor: false,
      insideArticleWithTopLevelPermalink: true,
    }),
    false,
  );
});

test("dom text-expander safety avoids generic more controls that can navigate away", () => {
  assert.equal(
    shouldClickDomTextExpanderControl({
      label: "See more",
      insideAnchor: false,
      insideDialog: false,
    }),
    true,
  );

  assert.equal(
    shouldClickDomTextExpanderControl({
      label: "More",
      insideAnchor: false,
      insideDialog: false,
    }),
    false,
  );

  assert.equal(
    shouldClickDomTextExpanderControl({
      label: "View more",
      insideAnchor: false,
      insideDialog: false,
    }),
    false,
  );

  assert.equal(
    shouldClickDomTextExpanderControl({
      label: "See more",
      insideAnchor: true,
      insideDialog: false,
    }),
    false,
  );
});

test("cookie-backed sessions stay sticky and skip automatic browser recycling", () => {
  const networkTap = {
    getStats() {
      return {
        totalRequests: 999,
      };
    },
  };

  assert.equal(
    shouldRecycleBrowser(
      {
        cookiesFile: "/tmp/cookies.json",
        browserRecycleRequests: 250,
      },
      networkTap,
    ),
    false,
  );

  assert.equal(
    shouldRecycleOnNetworkStall({
      cookiesFile: "/tmp/cookies.json",
    }),
    false,
  );
});

test("anonymous sessions still allow recycling when request thresholds are hit", () => {
  const networkTap = {
    getStats() {
      return {
        totalRequests: 300,
      };
    },
  };

  assert.equal(
    shouldRecycleBrowser(
      {
        cookiesFile: null,
        browserRecycleRequests: 250,
      },
      networkTap,
    ),
    true,
  );

  assert.equal(
    shouldRecycleOnNetworkStall({
      cookiesFile: null,
    }),
    true,
  );
});
