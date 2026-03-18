const URL_HINTS = [
  /\/ajax\/bulk-route-definitions\/?$/i,
  /\/ajax\/bz/i,
  /\/api\/graphql/i,
  /\/graphql/i,
  /\/groups\/[^/]+\/?$/i,
];

const BODY_HINTS = [
  "__bbox",
  "ScheduledServerJS",
  "post_id",
  "creation_time",
  "comet_sections",
  "CometGroupDiscussionRootSuccessQueryRelayPreloader",
  "groupID",
  "feedback",
  "actors",
];

export function classifyResponsePayload(payload) {
  const url = payload.url ?? "";
  const resourceType = payload.resourceType ?? "";
  const contentType = payload.contentType ?? "";
  const body = payload.body ?? "";
  const isFacebookPageUrl = /https:\/\/www\.facebook\.com\//i.test(url);
  let score = 0;
  const reasons = [];

  if (isFacebookPageUrl && URL_HINTS.some((pattern) => pattern.test(url))) {
    score += 2;
    reasons.push("url-pattern");
  }

  if ((resourceType === "document" || /xhr|fetch|other/i.test(resourceType)) && /text\/html|javascript|json/i.test(contentType)) {
    score += 1;
    reasons.push("content-type");
  }

  if (isFacebookPageUrl) {
    for (const hint of BODY_HINTS) {
      if (body.includes(hint)) {
        score += 2;
        reasons.push(`body:${hint}`);
        break;
      }
    }
  }

  return {
    relevant: score >= 3,
    score,
    reasons,
  };
}

export function classifyDocumentHtml(html) {
  const reasons = [];
  let score = 0;

  for (const hint of BODY_HINTS) {
    if (html.includes(hint)) {
      score += 1;
      reasons.push(hint);
    }
  }

  return {
    relevant: score >= 2,
    score,
    reasons,
  };
}
