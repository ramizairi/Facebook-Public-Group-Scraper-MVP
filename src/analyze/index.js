import { pathToFileURL } from "node:url";

import { buildWorkbookColumns } from "./columns.js";
import { loadAnalysisConfig } from "./load-config.js";
import { loadAnalysisPosts } from "./load-posts.js";
import { analyzePostsWithGemini } from "./gemini-client.js";
import { deriveCalendarWeek, deriveWeekday } from "./time-derived.js";
import { writeAnalysisWorkbook } from "./write-xlsx.js";

export function buildRow(post, analysis, plan = { columns: [] }) {
  const dynamicValues = analysis?.values ?? analysis ?? {};
  const row = {
    post_url: post.url ?? null,
    created_at: post.createdAt ?? null,
    calendar_week: deriveCalendarWeek(post.createdAt),
    weekday: deriveWeekday(post.createdAt),
    profile_name: post.authorName ?? null,
    post: post.text ?? post.rawFragment?.textPreview ?? null,
    reaction_count: post.reactionCount ?? null,
    comment_count: post.commentCount ?? null,
    share_count: post.shareCount ?? null,
  };

  for (const column of plan.columns ?? []) {
    row[column.key] = dynamicValues[column.key] ?? null;
  }

  return row;
}

const logger = {
  info(payload) {
    if (payload?.event === "gemini-analysis-plan") {
      console.log(`gemini-plan | sample=${payload.sampleSize} | model=${payload.model}`);
    }

    if (payload?.event === "gemini-analysis-batch") {
      console.log(
        `gemini-analysis | batch=${payload.batch}/${payload.totalBatches} | size=${payload.batchSize} | model=${payload.model}`,
      );
    }
  },
};

export async function runAnalysisWorkflow(
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  options = {},
) {
  const config = loadAnalysisConfig(argv, cwd, {
    envOverrides: options.envOverrides,
    requireInputFile: !Array.isArray(options.posts),
  });
  const posts = Array.isArray(options.posts) ? options.posts : await loadAnalysisPosts(config);
  const { plan, analyses } = await analyzePostsWithGemini(posts, config, logger);
  const rows = posts.map((post, index) => buildRow(post, analyses[index], plan));
  const outputPath = await writeAnalysisWorkbook(
    {
      rows,
      plan,
      columns: buildWorkbookColumns(plan),
    },
    config,
  );

  return {
    config,
    rows,
    plan,
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
