import { GoogleGenAI } from "@google/genai";

import {
  DEFAULT_ANALYSIS_PLAN,
  buildBatchAnalysisResponseJsonSchema,
  buildPlanResponseJsonSchema,
  normalizeAnalysisItem,
  normalizeAnalysisPlan,
} from "./plan.js";
import { buildBatchPrompt, buildPlanPrompt } from "./prompt.js";

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function safeParseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function inferAnalysisPlan(ai, posts, config, logger) {
  const samplePosts = posts.slice(0, Math.min(posts.length, 20));
  if (!samplePosts.length) {
    return DEFAULT_ANALYSIS_PLAN;
  }

  logger.info({
    event: "gemini-analysis-plan",
    sampleSize: samplePosts.length,
    model: config.geminiModel,
  });

  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: buildPlanPrompt(samplePosts),
      config: {
        temperature: 0.1,
        maxOutputTokens: Math.min(config.geminiMaxOutputTokens, 4096),
        responseMimeType: "application/json",
        responseJsonSchema: buildPlanResponseJsonSchema(),
      },
    });

    return normalizeAnalysisPlan(safeParseJson(response.text, DEFAULT_ANALYSIS_PLAN));
  } catch (error) {
    logger.info({
      event: "gemini-analysis-plan-fallback",
      reason: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_ANALYSIS_PLAN;
  }
}

export async function analyzePostsWithGemini(posts, config, logger) {
  const ai = new GoogleGenAI({
    apiKey: config.geminiApiKey,
  });

  const plan = await inferAnalysisPlan(ai, posts, config, logger);
  const analyses = new Array(posts.length).fill(null);
  const batches = chunk(posts, config.geminiBatchSize);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const prompt = buildBatchPrompt(batch, plan);

    logger.info({
      event: "gemini-analysis-batch",
      batch: batchIndex + 1,
      totalBatches: batches.length,
      batchSize: batch.length,
      model: config.geminiModel,
    });

    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        temperature: config.geminiTemperature,
        maxOutputTokens: config.geminiMaxOutputTokens,
        responseMimeType: "application/json",
        responseJsonSchema: buildBatchAnalysisResponseJsonSchema(plan),
      },
    });

    const parsed = safeParseJson(response.text, { items: [] });
    const items = Array.isArray(parsed?.items) ? parsed.items : [];

    for (const rawItem of items) {
      const item = normalizeAnalysisItem(rawItem, plan);
      if (item.index < 0 || item.index >= batch.length) {
        continue;
      }

      const globalIndex = (batchIndex * config.geminiBatchSize) + item.index;
      analyses[globalIndex] = item;
    }
  }

  return {
    plan,
    analyses,
  };
}
