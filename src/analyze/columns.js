export const BASE_ANALYSIS_COLUMNS = [
  { key: "post_url", label: "Post URL", type: "string", source: "fixed" },
  { key: "created_at", label: "Created At", type: "string", source: "fixed" },
  { key: "calendar_week", label: "Calendar Week", type: "string", source: "fixed" },
  { key: "weekday", label: "Weekday", type: "string", source: "fixed" },
  { key: "group_type", label: "Group Type", type: "string", source: "fixed" },
  { key: "profile_name", label: "Profile Name", type: "string", source: "fixed" },
  { key: "source_language", label: "Source Language", type: "string", source: "fixed" },
  { key: "post", label: "Post (Original)", type: "string", source: "fixed" },
  { key: "post_english", label: "Post English", type: "string", source: "fixed" },
  { key: "analysis_summary_en", label: "Analysis Summary EN", type: "string", source: "fixed" },
  { key: "analysis_confidence", label: "Analysis Confidence", type: "number", source: "fixed" },
  { key: "reaction_count", label: "Reaction Count", type: "number", source: "fixed" },
  { key: "comment_count", label: "Comment Count", type: "number", source: "fixed" },
  { key: "share_count", label: "Share Count", type: "number", source: "fixed" },
];

export function buildWorkbookColumns(plan) {
  return [
    ...BASE_ANALYSIS_COLUMNS,
    ...(plan?.columns ?? []).map((column) => ({
      key: column.key,
      label: column.label,
      type: column.type,
      source: "dynamic",
    })),
  ];
}
