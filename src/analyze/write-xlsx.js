import fs from "node:fs/promises";
import path from "node:path";

import * as XLSX from "xlsx";

function buildWorksheet(rows, columns) {
  const header = columns.map((column) => column.label);
  const values = rows.map((row) => columns.map((column) => row[column.key] ?? null));
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...values]);
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  if (worksheet["!ref"]) {
    worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  }
  worksheet["!cols"] = columns.map((column) => ({
    wch: Math.min(
      column.key === "post" || column.key === "post_english" || column.key === "analysis_summary_en" ? 80 : 36,
      Math.max(
        12,
        column.label.length + 2,
        ...rows
          .slice(0, 50)
          .map((row) => `${row[column.key] ?? ""}`.trim().length + 2),
      ),
    ),
  }));

  return worksheet;
}

function buildGroupInfoSheet(plan, rows) {
  return XLSX.utils.aoa_to_sheet([
    ["Property", "Value"],
    ["Group Type", plan.group_type],
    ["Sheet Name", plan.sheet_name],
    ["Summary", plan.summary],
    ["Row Count", rows.length],
    ["Generated At", new Date().toISOString()],
  ]);
}

function buildColumnInfoSheet(columns) {
  return XLSX.utils.json_to_sheet(
    columns.map((column) => ({
      key: column.key,
      label: column.label,
      type: column.type,
      source: column.source ?? "dynamic",
    })),
    {
      header: ["key", "label", "type", "source"],
    },
  );
}

export async function writeAnalysisWorkbook({ rows, plan, columns }, config) {
  await fs.mkdir(config.outputDir, { recursive: true });

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: `${plan.group_type} group analysis`,
    Subject: "Facebook group BI export",
    Author: "facebook-public-group-scraper",
  };
  XLSX.utils.book_append_sheet(workbook, buildWorksheet(rows, columns), plan.sheet_name);
  XLSX.utils.book_append_sheet(workbook, buildGroupInfoSheet(plan, rows), "group_info");
  XLSX.utils.book_append_sheet(workbook, buildColumnInfoSheet(columns), "data_dictionary");

  const outputPath = path.join(config.outputDir, config.outputFile);
  XLSX.writeFile(workbook, outputPath);
  return outputPath;
}
