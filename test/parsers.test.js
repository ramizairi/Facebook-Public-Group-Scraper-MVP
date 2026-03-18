import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  extractStructuredPostsFromDocument,
  extractStructuredPostsFromPayload,
} from "../src/extract/structured-parser.js";
import { safeJsonParseMany, stripFacebookPrefix } from "../src/utils/safe-json.js";

const fixturesDir = path.join(process.cwd(), "test", "fixtures");

test("stripFacebookPrefix removes the facebook prelude", () => {
  assert.equal(stripFacebookPrefix('for (;;);{"payload":null}'), '{"payload":null}');
});

test("safeJsonParseMany splits newline-delimited JSON documents", async () => {
  const body = await fs.readFile(path.join(fixturesDir, "graphql-stream.txt"), "utf8");
  const documents = safeJsonParseMany(body);

  assert.equal(documents.length, 2);
  assert.equal(documents[0].data.node.group_feed.edges[0].node.post_id, "333333333333333");
  assert.equal(documents[1].data.page_info.has_next_page, true);
});

test("extractStructuredPostsFromDocument finds embedded posts", async () => {
  const html = await fs.readFile(path.join(fixturesDir, "document.html"), "utf8");
  const posts = extractStructuredPostsFromDocument(html, {
    groupUrl: "https://www.facebook.com/groups/123456789012345/",
  });

  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "987654321012345");
  assert.equal(posts[0].authorName, "Alice Example");
  assert.equal(posts[0].reactionCount, 7);
});

test("extractStructuredPostsFromPayload finds network posts and ignores empty payloads", async () => {
  const body = await fs.readFile(path.join(fixturesDir, "bulk-route-definition.txt"), "utf8");
  const posts = extractStructuredPostsFromPayload(
    {
      url: "https://www.facebook.com/ajax/bulk-route-definitions/",
      body,
    },
    {
      groupUrl: "https://www.facebook.com/groups/123456789012345/",
    },
  );

  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "222222222222222");
  assert.equal(posts[0].authorName, "Bob Example");
  assert.equal(posts[0].commentCount, 4);

  const streamedBody = await fs.readFile(path.join(fixturesDir, "graphql-stream.txt"), "utf8");
  const streamedPosts = extractStructuredPostsFromPayload(
    {
      url: "https://www.facebook.com/api/graphql/",
      body: streamedBody,
    },
    {
      groupUrl: "https://www.facebook.com/groups/123456789012345/",
    },
  );

  assert.equal(streamedPosts.length, 1);
  assert.equal(streamedPosts[0].id, "333333333333333");
  assert.equal(streamedPosts[0].authorName, "Stream Example");
  assert.equal(streamedPosts[0].reactionCount, 9);

  const emptyBody = await fs.readFile(path.join(fixturesDir, "empty-bz.txt"), "utf8");
  const emptyPosts = extractStructuredPostsFromPayload(
    {
      url: "https://www.facebook.com/ajax/bz",
      body: emptyBody,
    },
    {
      groupUrl: "https://www.facebook.com/groups/123456789012345/",
    },
  );

  assert.deepEqual(emptyPosts, []);
});
