function formatPost(post, index) {
  const text = post.text ?? post.rawFragment?.textPreview ?? "";

  return [
    `POST_INDEX: ${index}`,
    `post_url: ${post.url ?? ""}`,
    `created_at: ${post.createdAt ?? ""}`,
    `profile_name: ${post.authorName ?? ""}`,
    `text: ${text}`,
  ].join("\n");
}

export function buildPlanPrompt(posts) {
  return `
You are designing the most useful spreadsheet schema for posts from one Facebook group.

Your job:
- infer what this group is mainly about from the sample posts
- choose a small set of useful dynamic columns for spreadsheet analysis
- make the columns fit this group without overfitting to one narrow example
- prefer columns that make filtering, sorting, and downstream analysis easier

Rules:
- choose 4 to 8 dynamic columns only
- each column must have a key, a type (string, number, boolean), and a human-friendly label
- values must be directly extractable or safely inferable from the post text or metadata
- do not create reaction_count, comment_count or share_count columns because they already exist as fixed columns
- keep keys in snake_case
- labels should be human-friendly for Excel
- allowed column types are string, number, boolean
- prefer columns that are useful across many posts in this specific group
- avoid duplicate or overlapping columns
- include one reusable intent column when possible
- the intent column must stay generic enough for this group: for example it may capture offer/request, sale/wanted, job_offer/job_seeker, rental_offer/rental_search, service_offer/service_request, announcement, question, complaint, or discussion
- strongly consider a profile_gender column when profile_name usually looks like a real personal name
- profile_gender must be inferred from profile_name only, never from post content, and should be left blank when the name is ambiguous, organizational, shared, or unclear
- prefer versatile columns such as topic, item_or_service, location_or_route, time_reference, price_or_budget, contact, condition, urgency, or availability when they fit the sample posts
- do not hardcode one group-specific pattern if a broader intent or category column would work better
- do not include the fixed columns that already exist:
  post_url, created_at, calendar_week, weekday, profile_name, post, reaction_count, comment_count, share_count,
- for Tunisian content, treat French, Tunisian Arabic, and Arabizi carefully
- if this group is clearly ride-sharing, marketplace, jobs, housing, services, or local community, reflect that in the chosen columns without making the schema brittle

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
- use profile_name only for columns that explicitly depend on the profile name, especially profile_gender
- if a gender-related column exists, infer it from profile_name only when the name strongly suggests it; otherwise return null
- return null when a value is not explicit or cannot be inferred safely
- keep summaries short and factual
- confidence must be from 0 to 1
- values must match the requested types exactly
- do not invent fields outside the schema
- if an intent or status column exists, normalize it to short reusable values that fit the group instead of copying a whole sentence
- examples of valid intent values depend on the group and may include offer, request, sale, wanted, job_offer, job_seeker, rental_offer, rental_search, service_offer, service_request, announcement, question, complaint, or discussion
- do not let one example such as offer vs request limit your extraction for other kinds of groups
- if the group is marketplace/jobs/housing/services, extract the most relevant details for that type of post

Return JSON only and match the schema exactly.

Posts:
${posts.map((post, index) => formatPost(post, index)).join("\n\n---\n\n")}
`.trim();
}
