function formatPost(post, index) {
  return [
    `POST_INDEX: ${index}`,
    `post_url: ${post.url ?? ""}`,
    `created_at: ${post.createdAt ?? ""}`,
    `profile_name: ${post.authorName ?? ""}`,
    `text: ${post.text ?? ""}`,
    `raw_text_preview: ${post.rawFragment?.textPreview ?? ""}`,
  ].join("\n");
}

export function buildPlanPrompt(posts) {
  return `
You are designing the best possible spreadsheet schema for a Facebook group.

Your job:
- infer what this group is mainly about from the sample posts
- choose a small set of useful dynamic columns for spreadsheet analysis
- make the columns fit this group, not only ride-sharing groups

Rules:
- choose 4 to 8 dynamic columns only
- keep keys in snake_case
- labels should be human-friendly for Excel
- allowed column types are string, number, boolean
- prefer columns that are useful across many posts in this specific group
- avoid duplicate or overlapping columns
- do not include the fixed columns that already exist:
  post_url, created_at, calendar_week, weekday, profile_name, post, gemini_summary, gemini_confidence
- for Tunisian content, treat French, Tunisian Arabic, and Arabizi carefully
- if this group is clearly ride-sharing, marketplace, jobs, housing, services, or local community, reflect that in the chosen columns

Return JSON only and match the schema exactly.

Sample posts:
${posts.map((post, index) => formatPost(post, index)).join("\n\n---\n\n")}
`.trim();
}

export function buildBatchPrompt(posts, plan) {
  return `
You extract structured spreadsheet rows from Facebook group posts.

Group type: ${plan.group_type}
Group extraction summary: ${plan.summary}

Dynamic columns to extract:
${plan.columns
  .map((column) => `- ${column.key} (${column.type}): ${column.description}`)
  .join("\n")}

Rules:
- work only from the provided post data
- posts may be written in Tunisian Arabic, French, Arabizi, English, or mixed language
- return null when a value is not explicit or cannot be inferred safely
- keep summaries short and factual
- confidence must be from 0 to 1
- values must match the requested types exactly
- do not invent fields outside the schema
- if the group is ride-sharing, distinguish offer vs request carefully
- if the group is marketplace/jobs/housing/services, extract the most relevant details for that type of post

Return JSON only and match the schema exactly.

Posts:
${posts.map((post, index) => formatPost(post, index)).join("\n\n---\n\n")}
`.trim();
}
