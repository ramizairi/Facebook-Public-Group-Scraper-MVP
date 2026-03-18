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

export function buildBatchPrompt(posts) {
  return `
You extract structured ride-sharing data from Tunisian Facebook group posts.

The posts may be written in:
- Tunisian Arabic
- French
- Arabizi / Tunisian Latin transliteration
- mixtures of all of them

Important interpretation rules:
- Treat Tunisian place names and common transport wording carefully.
- "Je cherche", "nlawj", "nheb", "cherche une place", "blassa", "place" usually indicates a ride request.
- "place disponible", "dispo", "disponible", "encore une place", "retour" often indicates a ride offer.
- Do not confuse phone numbers with price.
- Price must be explicit money in Tunisian dinars or a clearly monetary number.
- Number of passengers must be explicit. Do not infer from phone numbers or times.
- Gender should be inferred from the profile name only when reasonably likely. Otherwise return "unknown".
- from_city should be the departure city only.
- from_area should be a more specific neighborhood/area only. Do not duplicate the city there unless the post itself uses the city as the only departure area phrase.
- to_area should capture the destination phrase, area, or city.
- preferred_departure_time should be normalized when possible. Examples: "6.30" -> "06:30", "a partir de 15h" -> "15:00+", "demain matin" -> "morning".
- If something is not clear, return null.

Return JSON only and match the schema exactly.

Posts:
${posts.map((post, index) => formatPost(post, index)).join("\n\n---\n\n")}
`.trim();
}
