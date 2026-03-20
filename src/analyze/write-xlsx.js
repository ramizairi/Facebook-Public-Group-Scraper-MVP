import fs from "node:fs/promises";
import path from "node:path";

import * as XLSX from "xlsx";

function buildWorksheet(rows, columns) {
  const header = columns.map((column) => column.label);
  const values = rows.map((row) => columns.map((column) => row[column.key] ?? null));
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...values]);
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  worksheet["!cols"] = columns.map((column) => ({
    wch: Math.min(
      40,
      Math.max(
        column.label.length + 2,
        ...rows
          .slice(0, 50)
          .map((row) => `${row[column.key] ?? ""}`.trim().length + 2),
      ),
    ),
  }));

  return worksheet;
}

function buildGroupInfoSheet(plan) {
  return XLSX.utils.aoa_to_sheet([
    ["Property", "Value"],
    ["Group Type", plan.group_type],
    ["Sheet Name", plan.sheet_name],
    ["Summary", plan.summary],
  ]);
}

function buildColumnInfoSheet(plan) {
  return XLSX.utils.json_to_sheet(
    plan.columns.map((column) => ({
      key: column.key,
      label: column.label,
      type: column.type,
      description: column.description,
    })),
    {
      header: ["key", "label", "type", "description"],
    },
  );
}

export async function writeAnalysisWorkbook({ rows, plan, columns }, config) {
  await fs.mkdir(config.outputDir, { recursive: true });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildWorksheet(rows, columns), plan.sheet_name);
  XLSX.utils.book_append_sheet(workbook, buildGroupInfoSheet(plan), "group_info");
  XLSX.utils.book_append_sheet(workbook, buildColumnInfoSheet(plan), "column_map");

  const outputPath = path.join(config.outputDir, config.outputFile);
  XLSX.writeFile(workbook, outputPath);
  return outputPath;
}
