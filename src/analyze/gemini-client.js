import { GoogleGenAI } from "@google/genai";

import { AnalysisBatchSchema, analysisResponseJsonSchema } from "./schema.js";
import { buildBatchPrompt } from "./prompt.js";

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function analyzePostsWithGemini(posts, config, logger) {
  const ai = new GoogleGenAI({
    apiKey: config.geminiApiKey,
  });

  const analyses = new Array(posts.length).fill(null);
  const batches = chunk(posts, config.geminiBatchSize);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const prompt = buildBatchPrompt(batch);

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
        responseJsonSchema: analysisResponseJsonSchema,
      },
    });

    const parsed = AnalysisBatchSchema.parse(JSON.parse(response.text));
    for (const item of parsed.items) {
      if (item.index < 0 || item.index >= batch.length) {
        continue;
      }

      const globalIndex = (batchIndex * config.geminiBatchSize) + item.index;
      analyses[globalIndex] = item;
    }
  }

  return analyses;
}
