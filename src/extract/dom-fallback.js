import { extractGroupSlugOrId } from "../utils/facebook-url.js";

const DOM_ACTION_LABELS = new Set([
  "like",
  "comment",
  "share",
  "view more comments",
  "join group",
  "public group",
]);

const DOM_META_PATTERNS = [
  /^\d+\s*(?:m|min|h|d|w)$/i,
  /^\d+\s*(?:minutes?|hours?|days?|weeks?)$/i,
  /^shared with public group$/i,
  /^public group$/i,
  /^see more$/i,
  /^write a comment/i,
];

const DOM_LOAD_MORE_PATTERNS = [
  /see more posts/i,
  /view more posts/i,
  /more posts/i,
  /older posts/i,
  /previous posts/i,
  /show more/i,
  /view more/i,
];

function looksLikeTopLevelPostHref(href, currentGroupSlugOrId) {
  if (!href) {
    return false;
  }

  if (!/\/groups\//i.test(href)) {
    return false;
  }

  if (/comment_id=/i.test(href)) {
    return false;
  }

  if (currentGroupSlugOrId && !href.includes(`/groups/${currentGroupSlugOrId}/`)) {
    return false;
  }

  return /\/groups\/[^/]+\/(?:posts|permalink)\/\d+/i.test(href);
}

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

function cleanDomText(value) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (DOM_ACTION_LABELS.has(normalized.toLowerCase())) {
    return null;
  }

  if (DOM_META_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  return normalized;
}

function pickPostText(blocks) {
  const cleaned = dedupeStrings(blocks)
    .map(cleanDomText)
    .filter(Boolean)
    .filter((block) => !/^\d+$/.test(block));

  return cleaned.find((block, index) => index > 0 && block.length > 20) ?? null;
}

function pickPreviewText(preview, authorName) {
  const cleaned = cleanDomText(preview);
  if (!cleaned) {
    return null;
  }

  let normalized = cleaned;
  if (authorName) {
    const escapedAuthor = authorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized.replace(new RegExp(`^${escapedAuthor}\\s*`, "i"), "");
  }

  normalized = normalized
    .replace(/\b(?:like|comment|share)\b/gi, " ")
    .replace(/\bshared with public group\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.length >= 12 ? normalized : null;
}

export async function prepareDomExtraction(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page
    .evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll(
          '[role="article"] button, [role="article"] [role="button"], [role="feed"] button, [role="feed"] [role="button"]',
        ),
      );
      const expanders = candidates.filter((element) => {
        const label = `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

        if (!label) {
          return false;
        }

        if (/(like|comment|share|react|message|follow|join)/i.test(label)) {
          return false;
        }

        return /(see more|show more|view more|more|continue reading)/i.test(label);
      });

      for (const expander of expanders.slice(0, 12)) {
        expander.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
    })
    .catch(() => {});
}

export async function readDomFeedState(page, context) {
  const groupSlugOrId = extractGroupSlugOrId(context.groupUrl);

  return page
    .evaluate(({ currentGroupSlugOrId }) => {
      function absoluteHref(href) {
        try {
          return new URL(href, window.location.origin).toString();
        } catch {
          return null;
        }
      }

      function looksLikeTopLevelPostHref(href, currentGroupSlugOrId) {
        if (!href) {
          return false;
        }

        if (!/\/groups\//i.test(href)) {
          return false;
        }

        if (/comment_id=/i.test(href)) {
          return false;
        }

        if (currentGroupSlugOrId && !href.includes(`/groups/${currentGroupSlugOrId}/`)) {
          return false;
        }

        return /\/groups\/[^/]+\/(?:posts|permalink)\/\d+/i.test(href);
      }

      const articles = Array.from(
        new Set([
          ...document.querySelectorAll('[role="feed"] [role="article"]'),
          ...document.querySelectorAll('[role="article"]'),
        ]),
      );

      const topLevelUrls = articles
        .map((article) =>
          Array.from(article.querySelectorAll("a[href]"))
            .map((anchor) => absoluteHref(anchor.getAttribute("href")))
            .find((href) => looksLikeTopLevelPostHref(href, currentGroupSlugOrId)),
        )
        .filter(Boolean);

      return {
        articleCount: articles.length,
        topLevelCount: topLevelUrls.length,
        lastTopLevelUrl: topLevelUrls.at(-1) ?? null,
        lastSignature: topLevelUrls.slice(-3).join("|") || null,
      };
    }, { currentGroupSlugOrId: groupSlugOrId })
    .catch(() => ({
      articleCount: 0,
      topLevelCount: 0,
      lastTopLevelUrl: null,
      lastSignature: null,
    }));
}

export async function nudgeDomFeed(page, context) {
  const groupSlugOrId = extractGroupSlugOrId(context.groupUrl);

  await page
    .evaluate(({ currentGroupSlugOrId, loadMorePatterns }) => {
      function absoluteHref(href) {
        try {
          return new URL(href, window.location.origin).toString();
        } catch {
          return null;
        }
      }

      function looksLikeTopLevelPostHref(href, currentGroupSlugOrId) {
        if (!href) {
          return false;
        }

        if (!/\/groups\//i.test(href)) {
          return false;
        }

        if (/comment_id=/i.test(href)) {
          return false;
        }

        if (currentGroupSlugOrId && !href.includes(`/groups/${currentGroupSlugOrId}/`)) {
          return false;
        }

        return /\/groups\/[^/]+\/(?:posts|permalink)\/\d+/i.test(href);
      }

      function collectTopLevelArticles() {
        const articles = Array.from(
          new Set([
            ...document.querySelectorAll('[role="feed"] [role="article"]'),
            ...document.querySelectorAll('[role="article"]'),
          ]),
        );

        return articles
          .map((article) => {
            const url = Array.from(article.querySelectorAll("a[href]"))
              .map((anchor) => absoluteHref(anchor.getAttribute("href")))
              .find((href) => looksLikeTopLevelPostHref(href, currentGroupSlugOrId));

            return url ? { article, url } : null;
          })
          .filter(Boolean);
      }

      const topLevelArticles = collectTopLevelArticles();
      topLevelArticles.at(-1)?.article?.scrollIntoView?.({ block: "end", inline: "nearest" });

      const controls = Array.from(document.querySelectorAll('a[href], button, [role="button"]'));
      const loadMore = controls.filter((element) => {
        const label = `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

        if (!label) {
          return false;
        }

        if (/(like|comment|share|react|message|join|follow|invite)/i.test(label)) {
          return false;
        }

        return loadMorePatterns.some((pattern) => new RegExp(pattern, "i").test(label));
      });

      for (const control of loadMore.slice(0, 8)) {
        control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
    }, {
      currentGroupSlugOrId: groupSlugOrId,
      loadMorePatterns: DOM_LOAD_MORE_PATTERNS.map((pattern) => pattern.source),
    })
    .catch(() => {});
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
      const directBlocks = Array.from(article.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 25);

      const innerTextBlocks = (article.innerText ?? "")
        .split(/\n+/)
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 25);

      return [...directBlocks, ...innerTextBlocks];
    }

    function looksLikeTopLevelPostHref(href, currentGroupSlugOrId) {
      if (!href) {
        return false;
      }

      if (!/\/groups\//i.test(href)) {
        return false;
      }

      if (/comment_id=/i.test(href)) {
        return false;
      }

      if (currentGroupSlugOrId && !href.includes(`/groups/${currentGroupSlugOrId}/`)) {
        return false;
      }

      return /\/groups\/[^/]+\/(?:posts|permalink)\/\d+/i.test(href);
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

    const articles = Array.from(
      new Set([
        ...document.querySelectorAll('[role="feed"] [role="article"]'),
        ...document.querySelectorAll('[role="article"]'),
      ]),
    );
    return articles
      .map((article, index) => {
        const links = Array.from(article.querySelectorAll("a[href]"))
          .map((anchor) => absoluteHref(anchor.getAttribute("href")))
          .filter(Boolean)
          .filter((href) => looksLikeTopLevelPostHref(href, currentGroupSlugOrId));

        const topLevelLink = links[0] ?? null;

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
    text: pickPostText(candidate.textBlocks) ?? pickPreviewText(candidate.preview, candidate.authorName),
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
