import { z } from "zod";

const RESERVED_KEYS = new Set([
  "post_url",
  "created_at",
  "calendar_week",
  "weekday",
  "profile_name",
  "post",
  "gemini_summary",
  "gemini_confidence",
]);

export const AnalysisColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().min(1),
});

const RawAnalysisPlanSchema = z.object({
  group_type: z.string().min(1),
  sheet_name: z.string().min(1),
  summary: z.string().min(1),
  columns: z.array(AnalysisColumnSchema).min(1).max(10),
});

export const DEFAULT_ANALYSIS_PLAN = Object.freeze({
  group_type: "general-community",
  sheet_name: "group_analysis",
  summary:
    "General Facebook group analysis. Extract the post intent, topic, location, contact details, and any explicit price or time information.",
  columns: [
    {
      key: "intent",
      label: "Intent",
      type: "string",
      description: "Primary intent of the post, such as offer, request, sale, announcement, question, or discussion.",
    },
    {
      key: "topic",
      label: "Topic",
      type: "string",
      description: "Main topic, category, or theme of the post.",
    },
    {
      key: "location",
      label: "Location",
      type: "string",
      description: "Relevant location, city, area, or route explicitly mentioned in the post.",
    },
    {
      key: "time_reference",
      label: "Time Reference",
      type: "string",
      description: "Relevant time, date, schedule, or deadline explicitly mentioned in the post.",
    },
    {
      key: "price_or_budget",
      label: "Price or Budget",
      type: "string",
      description: "Any explicit price, budget, or monetary reference in the post.",
    },
    {
      key: "contact",
      label: "Contact",
      type: "string",
      description: "Useful contact detail such as phone number, WhatsApp, Messenger, or email when explicitly stated.",
    },
  ],
});

function sanitizeKey(value, index) {
  const base = `${value ?? ""}`
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const fallback = `field_${index + 1}`;
  const candidate = base || fallback;
  return RESERVED_KEYS.has(candidate) ? `${candidate}_value` : candidate;
}

function sanitizeLabel(value, fallback) {
  const normalized = `${value ?? ""}`.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function sanitizeSheetName(value) {
  const normalized = `${value ?? ""}`
    .replace(/[\[\]\*\/\\\?\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (normalized || DEFAULT_ANALYSIS_PLAN.sheet_name).slice(0, 31);
}

export function normalizeAnalysisPlan(input) {
  const parsed = RawAnalysisPlanSchema.safeParse(input);
  const source = parsed.success ? parsed.data : DEFAULT_ANALYSIS_PLAN;
  const seen = new Set();
  const columns = [];

  for (const [index, column] of source.columns.entries()) {
    let key = sanitizeKey(column.key, index);
    while (seen.has(key)) {
      key = `${key}_${index + 1}`;
    }

    seen.add(key);
    columns.push({
      key,
      label: sanitizeLabel(column.label, key),
      type: column.type,
      description: sanitizeLabel(column.description, `Extract ${key} when possible.`),
    });
  }

  if (!columns.length) {
    return DEFAULT_ANALYSIS_PLAN;
  }

  return {
    group_type: sanitizeLabel(source.group_type, DEFAULT_ANALYSIS_PLAN.group_type),
    sheet_name: sanitizeSheetName(source.sheet_name),
    summary: sanitizeLabel(source.summary, DEFAULT_ANALYSIS_PLAN.summary),
    columns,
  };
}

export function buildPlanResponseJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      group_type: {
        type: "string",
        description: "Short group type such as rideshare, marketplace, jobs, housing, services, or general-community.",
      },
      sheet_name: {
        type: "string",
        description: "Short Excel sheet name for the main analysis tab.",
      },
      summary: {
        type: "string",
        description: "Short summary of what matters when extracting posts from this group.",
      },
      columns: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string" },
            label: { type: "string" },
            type: { type: "string", enum: ["string", "number", "boolean"] },
            description: { type: "string" },
          },
          required: ["key", "label", "type", "description"],
        },
      },
    },
    required: ["group_type", "sheet_name", "summary", "columns"],
  };
}

function buildColumnValueSchema(column) {
  if (column.type === "number") {
    return {
      type: ["number", "null"],
      description: column.description,
    };
  }

  if (column.type === "boolean") {
    return {
      type: ["boolean", "null"],
      description: column.description,
    };
  }

  return {
    type: ["string", "null"],
    description: column.description,
  };
}

export function buildBatchAnalysisResponseJsonSchema(plan) {
  const valueProperties = Object.fromEntries(
    plan.columns.map((column) => [column.key, buildColumnValueSchema(column)]),
  );

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: {
              type: "integer",
              description: "Index of the source post inside the current batch.",
            },
            summary: {
              type: ["string", "null"],
              description: "Short one-line summary of the post.",
            },
            confidence: {
              type: ["number", "null"],
              description: "Confidence score from 0 to 1 for the extracted row.",
            },
            values: {
              type: "object",
              additionalProperties: false,
              properties: valueProperties,
              required: plan.columns.map((column) => column.key),
            },
          },
          required: ["index", "summary", "confidence", "values"],
        },
      },
    },
    required: ["items"],
  };
}

export function normalizeAnalysisItem(item, plan) {
  const values = {};

  for (const column of plan.columns) {
    const rawValue = item?.values?.[column.key];

    if (rawValue == null) {
      values[column.key] = null;
      continue;
    }

    if (column.type === "number") {
      values[column.key] = Number.isFinite(Number(rawValue)) ? Number(rawValue) : null;
      continue;
    }

    if (column.type === "boolean") {
      values[column.key] = typeof rawValue === "boolean" ? rawValue : null;
      continue;
    }

    values[column.key] = `${rawValue}`.trim() || null;
  }

  return {
    index: Number.isInteger(item?.index) ? item.index : -1,
    summary: item?.summary == null ? null : `${item.summary}`.trim() || null,
    confidence:
      item?.confidence == null || !Number.isFinite(Number(item.confidence))
        ? null
        : Math.max(0, Math.min(1, Number(item.confidence))),
    values,
  };
}
