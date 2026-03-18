import fs from "node:fs/promises";
import path from "node:path";

import { nowIso } from "../utils/time.js";
import { safeJsonStringify } from "../utils/safe-json.js";

export const CHECKPOINT_FILE = "checkpoint.json";

export async function loadCheckpoint(outputDir) {
  const filePath = path.join(outputDir, CHECKPOINT_FILE);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function buildCheckpoint({ config, posts, unfilteredPosts, stats }) {
  return {
    version: 2,
    savedAt: nowIso(),
    groupUrl: config.groupUrl,
    outputDir: config.outputDir,
    posts,
    unfilteredPosts: Array.isArray(unfilteredPosts) ? unfilteredPosts : posts,
    stats,
  };
}

export async function persistCheckpoint(outputDir, checkpoint) {
  await fs.writeFile(path.join(outputDir, CHECKPOINT_FILE), safeJsonStringify(checkpoint), "utf8");
}
