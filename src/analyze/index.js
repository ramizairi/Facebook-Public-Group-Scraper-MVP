import { pathToFileURL } from "node:url";

import { buildWorkbookColumns } from "./columns.js";
import { loadAnalysisConfig } from "./load-config.js";
import { loadAnalysisPosts } from "./load-posts.js";
import { analyzePostsWithGemini } from "./gemini-client.js";
import { deriveCalendarWeek, deriveWeekday } from "./time-derived.js";
import { writeAnalysisWorkbook } from "./write-xlsx.js";

function coerceBiValue(value, type, { defaultString = "", defaultNumber = 0 } = {}) {
  if (type === "number") {
    return Number.isFinite(Number(value)) ? Number(value) : defaultNumber;
  }

  if (type === "boolean") {
    return value === true ? 1 : 0;
  }

  if (value == null) {
    return defaultString;
  }

  const normalized = `${value}`.trim();
  return normalized || defaultString;
}

export function buildRow(post, analysis, plan = { columns: [] }) {
  const dynamicValues = analysis?.values ?? analysis ?? {};
  const row = {
    post_url: coerceBiValue(post.url, "string"),
    created_at: coerceBiValue(post.createdAt, "string"),
    calendar_week: coerceBiValue(deriveCalendarWeek(post.createdAt), "string"),
    weekday: coerceBiValue(deriveWeekday(post.createdAt), "string"),
    group_type: coerceBiValue(plan.group_type, "string"),
    profile_name: coerceBiValue(post.authorName, "string"),
    source_language: coerceBiValue(analysis?.sourceLanguage, "string", {
      defaultString: "unknown",
    }),
    post: coerceBiValue(post.text ?? post.rawFragment?.textPreview, "string"),
    post_english: coerceBiValue(analysis?.translatedPostEn, "string"),
    analysis_summary_en: coerceBiValue(analysis?.summary, "string"),
    analysis_confidence: coerceBiValue(analysis?.confidence, "number"),
    reaction_count: coerceBiValue(post.reactionCount, "number"),
    comment_count: coerceBiValue(post.commentCount, "number"),
    share_count: coerceBiValue(post.shareCount, "number"),
  };

  for (const column of plan.columns ?? []) {
    row[column.key] = coerceBiValue(dynamicValues[column.key], column.type, {
      defaultString: "unknown",
      defaultNumber: 0,
    });
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
