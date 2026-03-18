import assert from "node:assert/strict";
import test from "node:test";

import { classifyPageAccessSnapshot } from "../src/core/block-detection.js";

test("classifyPageAccessSnapshot blocks clear login walls", () => {
  const result = classifyPageAccessSnapshot({
    url: "https://www.facebook.com/groups/123456789012345/",
    title: "Facebook",
    bodyText: "See more on Facebook Log in to continue",
    hasFeed: false,
    visibleFeedPostLinks: 0,
    visibleAnyPostLinks: 0,
    scriptJsonCount: 4,
    groupTabCount: 0,
    hasGroupHeading: false,
  });

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "facebook-login-wall");
});

test("classifyPageAccessSnapshot does not block soft login overlays when group chrome exists", () => {
  const result = classifyPageAccessSnapshot({
    url: "https://www.facebook.com/groups/123456789012345/",
    title: "Some Public Group | Facebook",
    bodyText: "See more on Facebook Log In Public group",
    hasFeed: false,
    visibleFeedPostLinks: 0,
    visibleAnyPostLinks: 0,
    scriptJsonCount: 40,
    groupTabCount: 4,
    hasGroupHeading: true,
  });

  assert.equal(result.blocked, false);
  assert.equal(result.reason, null);
});

test("classifyPageAccessSnapshot blocks hard redirects to login", () => {
  const result = classifyPageAccessSnapshot({
    url: "https://www.facebook.com/login/device-based/regular/login/",
    title: "Log In",
    bodyText: "Log in to continue",
    hasFeed: false,
    visibleFeedPostLinks: 0,
    visibleAnyPostLinks: 0,
    scriptJsonCount: 0,
    groupTabCount: 0,
    hasGroupHeading: false,
  });

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "redirected-to-login");
});
