import { extractGroupSlugOrId } from "../utils/facebook-url.js";

const DOM_ACTION_LABELS = new Set([
  "like",
  "comment",
  "share",
  "view more comments",
  "join group",
  "public group",
]);

function dedupeStrings(values) {
  const result = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    if (result[result.length - 1] === value) {
      continue;
    }

    result.push(value);
  }

  return result;
}

function pickPostText(blocks) {
  const cleaned = dedupeStrings(blocks)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((block) => !DOM_ACTION_LABELS.has(block.toLowerCase()))
    .filter((block) => !/^\d+[hdwm]$/i.test(block))
    .filter((block) => !/^\d+$/.test(block));

  return cleaned.find((block, index) => index > 0 && block.length > 20) ?? null;
}

export async function extractDomPosts(page, context) {
  const groupSlugOrId = extractGroupSlugOrId(context.groupUrl);

  const rawCandidates = await page.evaluate(({ currentGroupSlugOrId }) => {
    function absoluteHref(href) {
      try {
        return new URL(href, window.location.origin).toString();
      } catch {
        return null;
      }
    }

    function collectMedia(article) {
      const items = [];
      const images = Array.from(article.querySelectorAll("img[src]")).slice(0, 8);
      const videos = Array.from(article.querySelectorAll("video[src], video source[src]")).slice(0, 4);

      for (const image of images) {
        items.push({ type: "image", url: image.src });
      }

      for (const video of videos) {
        items.push({ type: "video", url: video.src });
      }

      return items;
    }

    function collectTextBlocks(article) {
      return Array.from(article.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 25);
    }

    function collectAuthorName(article) {
      const candidates = Array.from(
        article.querySelectorAll('h2, h3, h4, strong, [role="button"], a[role="link"]'),
      )
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter((value) => value.length < 80)
        .filter((value) => !/^\d+[hdwm]$/i.test(value))
        .filter((value) => !["Like", "Comment", "Share", "See more", "View more comments"].includes(value));

      return candidates[0] ?? null;
    }

    const articles = Array.from(document.querySelectorAll('[role="feed"] [role="article"]'));
    return articles
      .map((article, index) => {
        const links = Array.from(
          article.querySelectorAll('a[href*="/groups/"][href*="/posts/"], a[href*="/groups/"][href*="/permalink/"]'),
        )
          .map((anchor) => absoluteHref(anchor.getAttribute("href")))
          .filter(Boolean)
          .filter((href) => !href.includes("comment_id="));

        const topLevelLink =
          links.find((href) => currentGroupSlugOrId && href.includes(`/groups/${currentGroupSlugOrId}/`)) ?? links[0];

        if (!topLevelLink) {
          return null;
        }

        const textBlocks = collectTextBlocks(article);
        const authorName = collectAuthorName(article);
        const reactionMatch = article.textContent?.match(/All reactions:?\s*(\d+)/i);

        return {
          index,
          url: topLevelLink,
          authorName,
          textBlocks,
          media: collectMedia(article),
          reactionCount: reactionMatch ? Number(reactionMatch[1]) : null,
          preview: article.textContent?.replace(/\s+/g, " ").trim().slice(0, 240) ?? null,
        };
      })
      .filter(Boolean);
  }, { currentGroupSlugOrId: groupSlugOrId });

  return rawCandidates.map((candidate) => ({
    id: null,
    url: candidate.url,
    groupUrl: context.groupUrl,
    authorName: candidate.authorName,
    authorId: null,
    createdAt: null,
    text: pickPostText(candidate.textBlocks),
    media: candidate.media,
    reactionCount: Number.isFinite(candidate.reactionCount) ? candidate.reactionCount : null,
    commentCount: null,
    shareCount: null,
    sourceType: "dom",
    rawFragment: {
      source: "dom-fallback",
      reference: `article:${candidate.index}`,
      textPreview: candidate.preview,
    },
  }));
}
