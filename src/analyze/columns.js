export const BASE_ANALYSIS_COLUMNS = [
  { key: "post_url", label: "Post URL" },
  { key: "created_at", label: "Created At" },
  { key: "calendar_week", label: "Calendar Week" },
  { key: "weekday", label: "Weekday" },
  { key: "profile_name", label: "Profile Name" },
  { key: "post", label: "Post" },
  { key: "gemini_summary", label: "Gemini Summary" },
  { key: "gemini_confidence", label: "Gemini Confidence" },
];

export function buildWorkbookColumns(plan) {
  return [
    ...BASE_ANALYSIS_COLUMNS,
    ...(plan?.columns ?? []).map((column) => ({
      key: column.key,
      label: column.label,
    })),
  ];
}
