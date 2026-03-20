import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApifyProxyOptions,
  buildConfigEnvOverrides,
  parseActorInput,
  summarizeApifyProxyOptions,
} from "../src/apify/input.js";

test("parseActorInput validates and normalizes core Actor input", () => {
  const input = parseActorInput({
    groupUrl: "https://www.facebook.com/groups/525468629029673/",
    maxPosts: 100,
    noProxy: false,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    },
  });

  assert.equal(input.groupUrl, "https://www.facebook.com/groups/525468629029673/");
  assert.equal(input.maxPosts, 100);
  assert.equal(input.proxyConfiguration?.apifyProxyGroups?.[0], "RESIDENTIAL");
});

test("buildConfigEnvOverrides maps Actor input to config-friendly env strings", () => {
  const overrides = buildConfigEnvOverrides({
    groupUrl: "https://www.facebook.com/groups/525468629029673/",
    maxPosts: 250,
    runtimeMinutes: 10,
    noNewPostCycles: 8,
    proxyConfiguration: {
      useApifyProxy: true,
    },
  });

  assert.equal(overrides.GROUP_URL, "https://www.facebook.com/groups/525468629029673/");
  assert.equal(overrides.MAX_POSTS, "250");
  assert.equal(overrides.RUNTIME_MINUTES, "10");
  assert.equal(overrides.NO_NEW_POST_CYCLES, "8");
  assert.equal(overrides.PROXY_SERVER, "");
  assert.equal(overrides.PROXY_POOL_DIR, "");
});

test("buildApifyProxyOptions supports Apify groups and country", () => {
  const options = buildApifyProxyOptions({
    noProxy: false,
    proxyCountryCode: "tn",
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    },
  });

  assert.deepEqual(options, {
    groups: ["RESIDENTIAL"],
    countryCode: "TN",
  });
  assert.deepEqual(summarizeApifyProxyOptions(options), {
    usesApifyProxy: true,
    groups: ["RESIDENTIAL"],
    countryCode: "TN",
    customProxyUrlCount: 0,
  });
});

test("buildApifyProxyOptions supports custom proxy URLs", () => {
  const options = buildApifyProxyOptions({
    noProxy: false,
    proxyConfiguration: {
      useApifyProxy: false,
      proxyUrls: ["http://user:pass@example.com:8000"],
    },
  });

  assert.deepEqual(options, {
    proxyUrls: ["http://user:pass@example.com:8000"],
  });
});
