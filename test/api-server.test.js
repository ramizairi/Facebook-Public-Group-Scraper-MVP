import assert from "node:assert/strict";
import test from "node:test";

import { createApiServer } from "../src/api/server.js";

const TEST_API_CONFIG = {
  host: "127.0.0.1",
  port: 3000,
  authKey: "test-secret",
  allowedOrigin: "https://app.example.com",
};

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
    apiConfig: TEST_API_CONFIG,
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
    apiConfig: TEST_API_CONFIG,
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
        "X-API-Key": TEST_API_CONFIG.authKey,
        Origin: TEST_API_CONFIG.allowedOrigin,
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
    assert.equal(response.headers.get("x-output-dir"), null);
    assert.equal(response.headers.get("access-control-allow-origin"), TEST_API_CONFIG.allowedOrigin);
    assert.equal(response.headers.get("access-control-expose-headers"), "Content-Disposition, X-Posts-Count");
    assert.equal(await response.text(), '[{"id":"1"}]\n');
  } finally {
    await close(server);
  }
});

test("POST /scrape validates the request body", async () => {
  const server = createApiServer({
    apiConfig: TEST_API_CONFIG,
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
        "X-API-Key": TEST_API_CONFIG.authKey,
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

test("POST /scrape requires an API key", async () => {
  const server = createApiServer({
    apiConfig: TEST_API_CONFIG,
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
        Origin: TEST_API_CONFIG.allowedOrigin,
      },
      body: JSON.stringify({
        groupUrl: "https://www.facebook.com/groups/test-group/",
        maxPosts: 5,
      }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Unauthorized.",
    });
    assert.equal(response.headers.get("access-control-allow-origin"), TEST_API_CONFIG.allowedOrigin);
  } finally {
    await close(server);
  }
});

test("POST /scrape rejects an invalid API key", async () => {
  const server = createApiServer({
    apiConfig: TEST_API_CONFIG,
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
        "X-API-Key": "wrong-secret",
      },
      body: JSON.stringify({
        groupUrl: "https://www.facebook.com/groups/test-group/",
        maxPosts: 5,
      }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Unauthorized.",
    });
  } finally {
    await close(server);
  }
});

test("OPTIONS /scrape returns CORS headers for the allowed origin", async () => {
  const server = createApiServer({
    apiConfig: TEST_API_CONFIG,
    runScrapeRequest: async () => {
      throw new Error("should not run");
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/scrape`, {
      method: "OPTIONS",
      headers: {
        Origin: TEST_API_CONFIG.allowedOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-api-key",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), TEST_API_CONFIG.allowedOrigin);
    assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
    assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type, X-API-Key");
    assert.equal(response.headers.get("vary"), "Origin");
  } finally {
    await close(server);
  }
});

test("disallowed browser origins do not receive permissive CORS headers", async () => {
  const server = createApiServer({
    apiConfig: TEST_API_CONFIG,
    runScrapeRequest: async (payload) => ({
      outputBuffer: Buffer.from('[{"id":"1"}]\n'),
      outputDir: "/tmp/output/api/test-group-3",
      outputFileName: "output.json",
      postsCount: 1,
      groupUrl: payload.groupUrl,
    }),
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_CONFIG.authKey,
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({
        groupUrl: "https://www.facebook.com/groups/test-group/",
        maxPosts: 5,
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("vary"), null);
  } finally {
    await close(server);
  }
});

test("POST /scrape rejects a second concurrent request", async () => {
  const firstRunStarted = Promise.withResolvers();
  const firstRunReleased = Promise.withResolvers();
  const server = createApiServer({
    apiConfig: TEST_API_CONFIG,
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
        "X-API-Key": TEST_API_CONFIG.authKey,
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
        "X-API-Key": TEST_API_CONFIG.authKey,
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
