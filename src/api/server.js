import http from "node:http";
import { pathToFileURL } from "node:url";

import { ZodError } from "zod";

import { safeJsonStringify } from "../utils/safe-json.js";
import { parseApiScrapeRequest, runApiScrapeRequest } from "./run-scrape-request.js";

const DEFAULT_API_HOST = "0.0.0.0";
const DEFAULT_API_PORT = 3000;
const MAX_REQUEST_BYTES = 64 * 1024;

function resolveApiPort(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_API_PORT;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(safeJsonStringify(payload));
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
  return `http://${request.headers.host ?? "127.0.0.1"}`;
}

export function createApiServer(
  {
    cwd = process.cwd(),
    runScrapeRequest = runApiScrapeRequest,
  } = {},
) {
  let activeRequestCount = 0;

  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", buildBaseUrl(request));

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        busy: activeRequestCount > 0,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/scrape") {
      if (activeRequestCount > 0) {
        sendJson(response, 409, {
          error: "Another scrape request is already in progress.",
        });
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(request);
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      activeRequestCount += 1;

      try {
        const requestPayload = parseApiScrapeRequest(payload);
        const result = await runScrapeRequest(requestPayload, { cwd });

        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(result.outputFileName)}"`,
          "X-Output-Dir": result.outputDir,
          "X-Posts-Count": String(result.postsCount),
          "X-Group-Url": result.groupUrl ?? "",
        });
        response.end(result.outputBuffer);
      } catch (error) {
        if (error instanceof ZodError) {
          sendJson(response, 400, {
            error: "Invalid scrape request.",
            issues: error.issues.map((issue) => issue.message),
          });
        } else {
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        activeRequestCount -= 1;
      }

      return;
    }

    sendJson(response, 404, {
      error: "Not found.",
    });
  });
}

export async function runApiMain({
  host = process.env.API_HOST || DEFAULT_API_HOST,
  port = resolveApiPort(process.env.API_PORT),
  cwd = process.cwd(),
  runScrapeRequest = runApiScrapeRequest,
} = {}) {
  const server = createApiServer({
    cwd,
    runScrapeRequest,
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  console.log(`api-ready | host=${host} | port=${port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runApiMain().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
