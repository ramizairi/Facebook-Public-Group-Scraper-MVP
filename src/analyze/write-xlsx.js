import fs from "node:fs/promises";
import path from "node:path";

import * as XLSX from "xlsx";

export async function writeAnalysisWorkbook(rows, config) {
  await fs.mkdir(config.outputDir, { recursive: true });

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: [
      "post_url",
      "created_at",
      "calendar WK",
      "WeekDay",
      "profile_name",
      "post",
      "gender",
      "stauts",
      "from_city",
      "from_area",
      "to_area",
      "prefered_departure_time",
      "price",
      "nb_passengers",
    ],
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "analysis");

  const outputPath = path.join(config.outputDir, config.outputFile);
  XLSX.writeFile(workbook, outputPath);
  return outputPath;
}
