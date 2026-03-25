import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

import { ZodError } from "zod";

import { safeJsonStringify } from "../utils/safe-json.js";
import { loadApiServerConfig } from "./config.js";
import { parseApiScrapeRequest, runApiScrapeRequest } from "./run-scrape-request.js";

const MAX_REQUEST_BYTES = 64 * 1024;

function readHeader(headers, name) {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" ? value : null;
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(safeJsonStringify(payload));
}

function sendNoContent(response, headers = {}) {
  response.writeHead(204, headers);
  response.end();
}

function sanitizeFilename(fileName) {
  if (typeof fileName !== "string" || !fileName.trim()) {
    return "output.json";
  }

  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;

    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error("Request body too large.");
    }

    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  return parsed;
}

function buildBaseUrl(request) {
  return `http://${readHeader(request.headers, "host") ?? "127.0.0.1"}`;
}

function digestSecret(value) {
  return createHash("sha256").update(typeof value === "string" ? value : "", "utf8").digest();
}

function matchesApiKey(providedKey, expectedKey) {
  return timingSafeEqual(digestSecret(providedKey), digestSecret(expectedKey));
}

function buildCorsHeaders(request, apiConfig) {
  const origin = readHeader(request.headers, "origin");
  if (!origin || origin !== apiConfig.allowedOrigin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": apiConfig.allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    "Access-Control-Expose-Headers": "Content-Disposition, X-Posts-Count",
    Vary: "Origin",
  };
}

export function createApiServer(
  {
    cwd = process.cwd(),
    runScrapeRequest = runApiScrapeRequest,
    apiConfig = loadApiServerConfig(),
  } = {},
) {
  let activeRequestCount = 0;

  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", buildBaseUrl(request));
    const corsHeaders = buildCorsHeaders(request, apiConfig);

    if (
      request.method === "OPTIONS" &&
      (url.pathname === "/scrape" || url.pathname === "/health")
    ) {
      sendNoContent(response, corsHeaders);
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(
        response,
        200,
        {
          ok: true,
          busy: activeRequestCount > 0,
        },
        corsHeaders,
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/scrape") {
      const providedApiKey = readHeader(request.headers, "x-api-key");
      if (!providedApiKey || !matchesApiKey(providedApiKey, apiConfig.authKey)) {
        sendJson(
          response,
          401,
          {
            error: "Unauthorized.",
          },
          corsHeaders,
        );
        return;
      }

      if (activeRequestCount > 0) {
        sendJson(
          response,
          409,
          {
            error: "Another scrape request is already in progress.",
          },
          corsHeaders,
        );
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(request);
      } catch (error) {
        sendJson(
          response,
          400,
          {
            error: error instanceof Error ? error.message : String(error),
          },
          corsHeaders,
        );
        return;
      }

      activeRequestCount += 1;

      try {
        const requestPayload = parseApiScrapeRequest(payload);
        const result = await runScrapeRequest(requestPayload, { cwd, apiConfig });

        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(result.outputFileName)}"`,
          "X-Posts-Count": String(result.postsCount),
          ...corsHeaders,
        });
        response.end(result.outputBuffer);
      } catch (error) {
        if (error instanceof ZodError) {
          sendJson(
            response,
            400,
            {
              error: "Invalid scrape request.",
              issues: error.issues.map((issue) => issue.message),
            },
            corsHeaders,
          );
        } else {
          sendJson(
            response,
            500,
            {
              error: error instanceof Error ? error.message : String(error),
            },
            corsHeaders,
          );
        }
      } finally {
        activeRequestCount -= 1;
      }

      return;
    }

    sendJson(
      response,
      404,
      {
        error: "Not found.",
      },
      corsHeaders,
    );
  });
}

export async function runApiMain({
  cwd = process.cwd(),
  runScrapeRequest = runApiScrapeRequest,
  apiConfig = loadApiServerConfig(),
} = {}) {
  const server = createApiServer({
    cwd,
    runScrapeRequest,
    apiConfig,
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(apiConfig.port, apiConfig.host, resolve);
  });

  console.log(`api-ready | host=${apiConfig.host} | port=${apiConfig.port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runApiMain().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
