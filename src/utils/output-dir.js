import path from "node:path";

const DEFAULT_RESULT_DIR = "result";

export function resolveLatestResultDir(cwd) {
  return path.join(cwd, "output", DEFAULT_RESULT_DIR);
}

export function resolveAutoOutputDir(cwd, { resume = false } = {}) {
  return path.join(cwd, "output", DEFAULT_RESULT_DIR);
}
