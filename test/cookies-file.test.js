import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadCookiesFromFile } from "../src/browser/cookies-file.js";

const logger = {
  info() {},
};

test("loadCookiesFromFile accepts a plain cookie array", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-cookies-test-"));

  try {
    const filePath = path.join(tempDir, "cookies.json");
    await fs.writeFile(
      filePath,
      JSON.stringify([
        {
          name: "c_user",
          value: "123",
          domain: ".facebook.com",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
        },
      ]),
      "utf8",
    );

    const cookies = await loadCookiesFromFile(filePath, logger);
    assert.equal(cookies.length, 1);
    assert.equal(cookies[0].name, "c_user");
    assert.equal(cookies[0].domain, ".facebook.com");
    assert.equal(cookies[0].sameSite, "Lax");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadCookiesFromFile accepts a storageState-style object", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-cookies-test-"));

  try {
    const filePath = path.join(tempDir, "cookies.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        cookies: [
          {
            name: "xs",
            value: "abc",
            url: "https://www.facebook.com",
            sameSite: "None",
          },
        ],
      }),
      "utf8",
    );

    const cookies = await loadCookiesFromFile(filePath, logger);
    assert.equal(cookies.length, 1);
    assert.equal(cookies[0].url, "https://www.facebook.com");
    assert.equal(cookies[0].sameSite, "None");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
