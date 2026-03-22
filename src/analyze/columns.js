export const BASE_ANALYSIS_COLUMNS = [
  { key: "post_url", label: "Post URL" },
  { key: "created_at", label: "Created At" },
  { key: "calendar_week", label: "Calendar Week" },
  { key: "weekday", label: "Weekday" },
  { key: "profile_name", label: "Profile Name" },
  { key: "post", label: "Post" },
  { key: "reaction_count", label: "Reaction Count" },
  { key: "comment_count", label: "Comment Count" },
  { key: "share_count", label: "Share Count" },
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
