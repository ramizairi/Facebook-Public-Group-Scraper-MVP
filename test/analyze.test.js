import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildWorkbookColumns } from "../src/analyze/columns.js";
import { buildRow } from "../src/analyze/index.js";
import { loadAnalysisConfig } from "../src/analyze/load-config.js";
import { loadAnalysisPosts } from "../src/analyze/load-posts.js";
import { deriveCalendarWeek, deriveWeekday } from "../src/analyze/time-derived.js";
import { DEFAULT_ANALYSIS_PLAN, normalizeAnalysisPlan } from "../src/analyze/plan.js";

const ENV_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_BATCH_SIZE",
  "GEMINI_TEMPERATURE",
  "GEMINI_MAX_OUTPUT_TOKENS",
  "ANALYZER_INPUT_DIR",
  "ANALYZER_INPUT_FILE",
  "ANALYZER_USE_UNFILTERED_POSTS",
  "MAX_POSTS_TO_ANALYZE",
  "ANALYZER_OUTPUT_DIR",
  "ANALYZER_OUTPUT_FILE",
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

test("deriveCalendarWeek and deriveWeekday use Africa/Tunis calendar values", () => {
  assert.equal(deriveCalendarWeek("2026-03-18T18:31:13.000Z"), "2026-W12");
  assert.equal(deriveWeekday("2026-03-18T18:31:13.000Z"), "Wednesday");
});

test("loadAnalysisConfig defaults to the current group output folder and writes xlsx there too", async () => {
  const previousEnv = snapshotEnv();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-analyze-test-"));

  try { 
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    await fs.writeFile(
      path.join(tempDir, ".env"),
      [
        "GEMINI_API_KEY=test-key",
        "GROUP_URL=https://www.facebook.com/groups/123456789012345/",
      ].join("\n"),
      "utf8",
    );

    const resultDir = path.join(tempDir, "output", "123456789012345");
    await fs.mkdir(resultDir, { recursive: true });
    await fs.writeFile(path.join(resultDir, "output.json"), "[]", "utf8");

    const config = loadAnalysisConfig([], tempDir);
    assert.equal(config.inputDir, resultDir);
    assert.equal(config.inputPostsFile, path.join(resultDir, "output.json"));
    assert.equal(config.outputDir, resultDir);
  } finally {
    restoreEnv(previousEnv);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("buildRow includes post text with textPreview fallback", () => {
  const plan = normalizeAnalysisPlan({
    group_type: "rideshare",
    sheet_name: "rides",
    summary: "Ride-sharing group focused on routes, timing, and seats.",
    columns: [
      {
        key: "status",
        label: "Status",
        type: "string",
        description: "Offer, request, or unknown.",
      },
      {
        key: "route",
        label: "Route",
        type: "string",
        description: "Main route or destination phrase.",
      },
    ],
  });

  const withText = buildRow(
    {
      url: "https://www.facebook.com/groups/1/posts/2/",
      createdAt: "2026-03-18T18:31:13.000Z",
      authorName: "Test User",
      text: "Slm, Je cherche une place de tunis a sousse demain a partir de 15h",
      reactionCount: 5,
      commentCount: 2,
      shareCount: 1,
      rawFragment: { textPreview: "preview text" },
    },
    {
      summary: "Ride request from Tunis to Sousse tomorrow after 15:00.",
      sourceLanguage: "french",
      translatedPostEn: "Hello, I am looking for a seat from Tunis to Sousse tomorrow after 15:00.",
      confidence: 0.88,
      values: {
        status: "request",
        route: "Tunis -> Sousse",
      },
    },
    plan,
  );

  assert.equal(withText.post, "Slm, Je cherche une place de tunis a sousse demain a partir de 15h");
  assert.equal(withText.calendar_week, "2026-W12");
  assert.equal(withText.weekday, "Wednesday");
  assert.equal(withText.group_type, "rideshare");
  assert.equal(withText.source_language, "french");
  assert.equal(withText.post_english, "Hello, I am looking for a seat from Tunis to Sousse tomorrow after 15:00.");
  assert.equal(withText.analysis_summary_en, "Ride request from Tunis to Sousse tomorrow after 15:00.");
  assert.equal(withText.analysis_confidence, 0.88);
  assert.equal(withText.reaction_count, 5);
  assert.equal(withText.comment_count, 2);
  assert.equal(withText.share_count, 1);
  assert.equal(withText.status, "request");
  assert.equal(withText.route, "Tunis -> Sousse");

  const fallback = buildRow(
    {
      url: "https://www.facebook.com/groups/1/posts/3/",
      createdAt: null,
      authorName: "Test User",
      text: null,
      rawFragment: { textPreview: "preview text" },
    },
    null,
    plan,
  );

  assert.equal(fallback.post, "preview text");
  assert.equal(fallback.source_language, "unknown");
  assert.equal(fallback.post_english, "");
  assert.equal(fallback.analysis_confidence, 0);
  assert.equal(fallback.status, "unknown");
});

test("normalizeAnalysisPlan sanitizes dynamic columns and falls back safely", () => {
  const plan = normalizeAnalysisPlan({
    group_type: "marketplace",
    sheet_name: "Buy / Sell: Tunis?",
    summary: "Posts are mostly buying and selling items.",
    columns: [
      {
        key: "Price or Budget",
        label: "Price / Budget",
        type: "string",
        description: "Explicit price or budget.",
      },
      {
        key: "post",
        label: "Reserved",
        type: "string",
        description: "Should be renamed away from reserved columns.",
      },
    ],
  });

  assert.equal(plan.sheet_name, "Buy Sell Tunis");
  assert.ok(plan.columns.some((column) => column.key === "intent"));
  assert.ok(plan.columns.some((column) => column.key === "profile_gender"));
  assert.ok(plan.columns.some((column) => column.key === "price_or_budget"));
  assert.ok(plan.columns.some((column) => column.key === "post_value"));
});

test("buildWorkbookColumns combines fixed and dynamic columns", () => {
  const columns = buildWorkbookColumns(DEFAULT_ANALYSIS_PLAN);
  assert.equal(columns[0].key, "post_url");
  assert.equal(columns[0].label, "Post URL");
  assert.ok(columns.some((column) => column.key === "group_type"));
  assert.ok(columns.some((column) => column.key === "source_language"));
  assert.ok(columns.some((column) => column.key === "post_english"));
  assert.ok(columns.some((column) => column.key === "analysis_confidence"));
  assert.ok(columns.some((column) => column.key === "reaction_count"));
  assert.ok(columns.some((column) => column.key === "comment_count"));
  assert.ok(columns.some((column) => column.key === "share_count"));
  assert.ok(columns.some((column) => column.key === DEFAULT_ANALYSIS_PLAN.columns[0].key));
});

test("loadAnalysisPosts normalizes output.json rows for Gemini input", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-analyze-posts-test-"));

  try {
    const inputFile = path.join(tempDir, "output.json");
    await fs.writeFile(
      inputFile,
      JSON.stringify([
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
      ]),
      "utf8",
    );

    const posts = await loadAnalysisPosts({
      inputPostsFile: inputFile,
      maxPostsToAnalyze: null,
    });

    assert.deepEqual(posts[0], {
      url: "https://www.facebook.com/groups/1/posts/2/",
      groupUrl: "https://www.facebook.com/groups/1/",
      authorName: "Test User",
      createdAt: "2026-03-20T12:00:00.000Z",
      text: "Hello world",
      reactionCount: 5,
      commentCount: 2,
      shareCount: 1,
      rawFragment: null,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
