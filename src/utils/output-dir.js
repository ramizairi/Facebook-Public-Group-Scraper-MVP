import fs from "node:fs";
import path from "node:path";

const RESULT_DIR_PATTERN = /^result(\d+)$/i;

function listResultNumbers(outputRoot) {
  try {
    return fs
      .readdirSync(outputRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const match = entry.name.match(RESULT_DIR_PATTERN);
        return match ? Number(match[1]) : null;
      })
      .filter((value) => Number.isInteger(value) && value > 0)
      .sort((left, right) => left - right);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export function resolveLatestResultDir(cwd) {
  const outputRoot = path.join(cwd, "output");
  const resultNumbers = listResultNumbers(outputRoot);
  const latest = resultNumbers.at(-1);
  return latest ? path.join(outputRoot, `result${latest}`) : null;
}

export function resolveAutoOutputDir(cwd, { resume = false } = {}) {
  const outputRoot = path.join(cwd, "output");
  const resultNumbers = listResultNumbers(outputRoot);

  const selectedNumber = resume
    ? (resultNumbers.at(-1) ?? 1)
    : ((resultNumbers.at(-1) ?? 0) + 1);

  return path.join(outputRoot, `result${selectedNumber}`);
}
