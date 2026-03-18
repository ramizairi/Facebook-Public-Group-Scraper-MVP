import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRow } from "../src/analyze/index.js";
import { loadAnalysisConfig } from "../src/analyze/load-config.js";
import { deriveCalendarWeek, deriveWeekday } from "../src/analyze/time-derived.js";

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

test("loadAnalysisConfig defaults to the cumulative result posts.json", async () => {
  const previousEnv = snapshotEnv();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-analyze-test-"));

  try {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    await fs.writeFile(
      path.join(tempDir, ".env"),
      ["GEMINI_API_KEY=test-key", "ANALYZER_OUTPUT_DIR=output/xlsx"].join("\n"),
      "utf8",
    );

    const resultDir = path.join(tempDir, "output", "result");
    await fs.mkdir(resultDir, { recursive: true });
    await fs.writeFile(path.join(resultDir, "posts.json"), "[]", "utf8");

    const config = loadAnalysisConfig([], tempDir);
    assert.equal(config.inputDir, resultDir);
    assert.equal(config.inputPostsFile, path.join(resultDir, "posts.json"));
    assert.equal(config.outputDir, path.join(tempDir, "output", "xlsx"));
  } finally {
    restoreEnv(previousEnv);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("buildRow includes post text with textPreview fallback", () => {
  const withText = buildRow(
    {
      url: "https://www.facebook.com/groups/1/posts/2/",
      createdAt: "2026-03-18T18:31:13.000Z",
      authorName: "Test User",
      text: "Slm, Je cherche une place de tunis a sousse demain a partir de 15h",
      rawFragment: { textPreview: "preview text" },
    },
    {
      gender: "unknown",
      status: "request",
      from_city: "Tunis",
      from_area: null,
      to_area: "Sousse",
      preferred_departure_time: "15:00+",
      price: null,
      nb_passengers: 1,
    },
  );

  assert.equal(withText.post, "Slm, Je cherche une place de tunis a sousse demain a partir de 15h");

  const fallback = buildRow(
    {
      url: "https://www.facebook.com/groups/1/posts/3/",
      createdAt: null,
      authorName: "Test User",
      text: null,
      rawFragment: { textPreview: "preview text" },
    },
    null,
  );

  assert.equal(fallback.post, "preview text");
});
