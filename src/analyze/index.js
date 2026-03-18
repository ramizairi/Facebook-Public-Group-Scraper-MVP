import { pathToFileURL } from "node:url";

import { loadAnalysisConfig } from "./load-config.js";
import { loadAnalysisPosts } from "./load-posts.js";
import { analyzePostsWithGemini } from "./gemini-client.js";
import { deriveCalendarWeek, deriveWeekday } from "./time-derived.js";
import { writeAnalysisWorkbook } from "./write-xlsx.js";

export function buildRow(post, analysis) {
  return {
    post_url: post.url ?? null,
    created_at: post.createdAt ?? null,
    "calendar WK": deriveCalendarWeek(post.createdAt),
    WeekDay: deriveWeekday(post.createdAt),
    profile_name: post.authorName ?? null,
    post: post.text ?? post.rawFragment?.textPreview ?? null,
    gender: analysis?.gender ?? "unknown",
    stauts: analysis?.status ?? "unknown",
    from_city: analysis?.from_city ?? null,
    from_area: analysis?.from_area ?? null,
    to_area: analysis?.to_area ?? null,
    prefered_departure_time: analysis?.preferred_departure_time ?? null,
    price: analysis?.price ?? null,
    nb_passengers: analysis?.nb_passengers ?? null,
  };
}

const logger = {
  info(payload) {
    if (payload?.event === "gemini-analysis-batch") {
      console.log(
        `gemini-analysis | batch=${payload.batch}/${payload.totalBatches} | size=${payload.batchSize} | model=${payload.model}`,
      );
    }
  },
};

export async function runAnalysisWorkflow(argv = process.argv.slice(2), cwd = process.cwd()) {
  const config = loadAnalysisConfig(argv, cwd);
  const posts = await loadAnalysisPosts(config);
  const analyses = await analyzePostsWithGemini(posts, config, logger);
  const rows = posts.map((post, index) => buildRow(post, analyses[index]));
  const outputPath = await writeAnalysisWorkbook(rows, config);

  return {
    config,
    rows,
    outputPath,
  };
}

async function main() {
  const { rows, outputPath } = await runAnalysisWorkflow();
  console.log(`analysis-completed | rows=${rows.length} | output=${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
