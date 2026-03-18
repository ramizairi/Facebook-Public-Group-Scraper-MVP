export function classifyPageAccessSnapshot(snapshot) {
  const combined = `${snapshot.title}\n${snapshot.bodyText}`;
  const hardBlockPatterns = [
    /temporarily blocked/i,
    /review the security of your connection/i,
    /unusual traffic/i,
    /captcha/i,
    /checkpoint/i,
  ];

  if (hardBlockPatterns.some((pattern) => pattern.test(combined))) {
    return {
      blocked: true,
      reason: "facebook-block-interstitial",
      snapshot,
    };
  }

  const loginPatterns = [/log in/i, /see more on facebook/i, /create new account/i];
  const loginLike = loginPatterns.some((pattern) => pattern.test(combined));
  const onGroupRoute = /\/groups\//i.test(snapshot.url);
  const hasUsableSurface =
    snapshot.hasFeed ||
    snapshot.visibleFeedPostLinks > 0 ||
    snapshot.visibleAnyPostLinks > 0 ||
    (onGroupRoute &&
      (snapshot.scriptJsonCount >= 20 || snapshot.groupTabCount > 0 || snapshot.hasGroupHeading));

  if (/\/login\//i.test(snapshot.url)) {
    return {
      blocked: true,
      reason: "redirected-to-login",
      snapshot,
    };
  }

  if (loginLike && !hasUsableSurface) {
    return {
      blocked: true,
      reason: "facebook-login-wall",
      snapshot,
    };
  }

  return {
    blocked: false,
    reason: null,
    snapshot,
  };
}

export async function detectBlockState(page) {
  const snapshot = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bodyText: document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 4_000) ?? "",
    hasFeed: Boolean(document.querySelector('[role="feed"]')),
    visibleFeedPostLinks: document.querySelectorAll(
      '[role="feed"] a[href*="/groups/"][href*="/posts/"], [role="feed"] a[href*="/groups/"][href*="/permalink/"]',
    ).length,
    visibleAnyPostLinks: document.querySelectorAll(
      'a[href*="/groups/"][href*="/posts/"], a[href*="/groups/"][href*="/permalink/"]',
    ).length,
    scriptJsonCount: document.querySelectorAll('script[type="application/json"]').length,
    groupTabCount: document.querySelectorAll('[role="tab"]').length,
    hasGroupHeading: Boolean(
      Array.from(document.querySelectorAll("h1, [role='heading']")).find((element) =>
        /public group|group/i.test(element.textContent ?? ""),
      ),
    ),
  }));

  return classifyPageAccessSnapshot(snapshot);
}
