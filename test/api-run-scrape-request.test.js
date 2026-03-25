import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runApiScrapeRequest } from "../src/api/run-scrape-request.js";

class FakeOutputManager {
  constructor(outputDir) {
    this.paths = {
      outputJson: path.join(outputDir, "output.json"),
      logFile: path.join(outputDir, "run.log"),
    };
  }

  static async create(outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "output.json"), "[]\n", "utf8");
    return new FakeOutputManager(outputDir);
  }
}

const fakeLogger = {
  info() {},
};

test("runApiScrapeRequest forwards API_COOKIES_FILE into scraper config", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-api-request-test-"));
  let capturedConfig;

  try {
    await runApiScrapeRequest(
      {
        groupUrl: "https://www.facebook.com/groups/525468629029673/",
        maxPosts: 5,
      },
      {
        cwd: tempDir,
        apiConfig: {
          cookiesFile: "cookies.json",
        },
        outputManagerClass: FakeOutputManager,
        createLoggerImpl: () => fakeLogger,
        runScraperImpl: async (config) => {
          capturedConfig = config;
          return {
            posts: [],
          };
        },
      },
    );

    assert.equal(capturedConfig.cookiesFile, path.join(tempDir, "cookies.json"));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
