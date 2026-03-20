import path from "node:path";
import { deriveOutputSlug } from "./facebook-url.js";

const DEFAULT_RESULT_DIR = "result";

export function resolveLatestResultDir(cwd, { groupUrl = null } = {}) {
  const outputSlug = groupUrl ? deriveOutputSlug(groupUrl) : DEFAULT_RESULT_DIR;
  return path.join(cwd, "output", outputSlug);
}

export function resolveAutoOutputDir(cwd, { groupUrl = null } = {}) {
  return resolveLatestResultDir(cwd, { groupUrl });
}
