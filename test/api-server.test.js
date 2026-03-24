import assert from "node:assert/strict";
import test from "node:test";

import { createApiServer } from "../src/api/server.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("GET /health reports readiness", async () => {
  const server = createApiServer({
    runScrapeRequest: async () => {
      throw new Error("should not run");
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      busy: false,
    });
  } finally {
    await close(server);
  }
});

test("POST /scrape returns output.json as the response body", async () => {
  const server = createApiServer({
    runScrapeRequest: async (payload) => {
      assert.deepEqual(payload, {
        groupUrl: "https://www.facebook.com/groups/test-group/",
        maxPosts: 5,
      });

      return {
        outputBuffer: Buffer.from('[{"id":"1"}]\n'),
        outputDir: "/tmp/output/api/test-group-1",
        outputFileName: "output.json",
        postsCount: 1,
        groupUrl: payload.groupUrl,
      };
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupUrl: "https://www.facebook.com/groups/test-group/",
        maxPosts: 5,
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="output.json"');
    assert.equal(response.headers.get("x-posts-count"), "1");
    assert.equal(await response.text(), '[{"id":"1"}]\n');
  } finally {
    await close(server);
  }
});

test("POST /scrape validates the request body", async () => {
  const server = createApiServer({
    runScrapeRequest: async () => {
      throw new Error("should not run");
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        maxPosts: 5,
      }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Invalid scrape request.");
    assert.ok(Array.isArray(body.issues));
    assert.ok(body.issues.length >= 1);
  } finally {
    await close(server);
  }
});

test("POST /scrape rejects a second concurrent request", async () => {
  const firstRunStarted = Promise.withResolvers();
  const firstRunReleased = Promise.withResolvers();
  const server = createApiServer({
    runScrapeRequest: async () => {
      firstRunStarted.resolve();
      await firstRunReleased.promise;

      return {
        outputBuffer: Buffer.from("[]\n"),
        outputDir: "/tmp/output/api/test-group-2",
        outputFileName: "output.json",
        postsCount: 0,
        groupUrl: "https://www.facebook.com/groups/test-group/",
      };
    },
  });
  const baseUrl = await listen(server);

  try {
    const firstResponsePromise = fetch(`${baseUrl}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupUrl: "https://www.facebook.com/groups/test-group/",
        maxPosts: 1,
      }),
    });

    await firstRunStarted.promise;

    const secondResponse = await fetch(`${baseUrl}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupUrl: "https://www.facebook.com/groups/test-group/",
        maxPosts: 1,
      }),
    });

    assert.equal(secondResponse.status, 409);
    assert.deepEqual(await secondResponse.json(), {
      error: "Another scrape request is already in progress.",
    });

    firstRunReleased.resolve();
    const firstResponse = await firstResponsePromise;
    assert.equal(firstResponse.status, 200);
  } finally {
    firstRunReleased.resolve();
    await close(server);
  }
});
