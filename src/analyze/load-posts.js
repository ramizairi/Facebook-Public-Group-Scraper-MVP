import fs from "node:fs/promises";

export async function loadAnalysisPosts(config) {
  const raw = await fs.readFile(config.inputPostsFile, "utf8");
  const posts = JSON.parse(raw);
  if (!Array.isArray(posts)) {
    throw new Error(`Expected an array of posts in ${config.inputPostsFile}`);
  }

  return config.maxPostsToAnalyze ? posts.slice(0, config.maxPostsToAnalyze) : posts;
}
