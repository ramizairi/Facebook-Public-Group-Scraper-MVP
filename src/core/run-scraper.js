import { buildCheckpoint, loadCheckpoint } from "./checkpoint.js";
import { DedupStore } from "./dedup-store.js";
import { detectBlockState } from "./block-detection.js";
import { MetricsTracker } from "./metrics.js";
import { normalizeCandidate } from "./normalize.js";
import { isRetriableProxyError } from "../browser/proxy-errors.js";
import { normalizeProxyConfig, ProxyPool } from "../browser/proxy-pool.js";
import { SessionStateStore } from "../browser/session-state.js";
import { closeBrowserSession, launchBrowserSession } from "../browser/session.js";
import { warmupFacebookSession } from "../browser/warmup.js";
import { sleepWithJitter } from "../utils/delay.js";
import { extractPostInfoFromUrl, sameGroupUrl } from "../utils/facebook-url.js";
import { elapsedMs, minutesToMs } from "../utils/time.js";
import { NetworkTap } from "../extract/network-tap.js";
import {
  extractDomPosts,
  nudgeDomFeed,
  prepareDomExtraction,
  readDomFeedState,
} from "../extract/dom-fallback.js";
import {
  extractStructuredPostsFromDocument,
  extractStructuredPostsFromPayload,
} from "../extract/structured-parser.js";
import { printProgress } from "../output/logger.js";

async function navigateToGroup(page, groupUrl) {
  await page.goto(groupUrl, {
    waitUntil: "domcontentloaded",
  });

  await page.keyboard.press("Escape").catch(() => {});
}

async function dismissPotentialOverlays(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page
    .evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll(
          'div[role="dialog"] button, div[role="dialog"] [role="button"], div[role="dialog"] [aria-label]',
        ),
      );
      const closeLike = candidates.find((element) => {
        const label = `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`.trim();
        return /close|not now|dismiss/i.test(label);
      });

      closeLike?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    })
    .catch(() => {});
}

async function settleStartupPage(page, config) {
  await dismissPotentialOverlays(page);
  if (config.startupSettleMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, config.startupSettleMs));
  }
  await dismissPotentialOverlays(page);
}

async function recoverFeedContextIfNavigated(page, config, logger) {
  const currentUrl = page.url();
  const postInfo = extractPostInfoFromUrl(currentUrl);
  if (!postInfo) {
    return false;
  }

  logger.info({
    event: "feed-context-recover",
    reason: "navigated-to-post",
    currentUrl,
    targetGroupUrl: config.groupUrl,
  });

  await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
  await dismissPotentialOverlays(page);

  if (extractPostInfoFromUrl(page.url())) {
    await navigateToGroup(page, config.groupUrl);
    await settleStartupPage(page, config);
  }

  return true;
}

async function advanceFeed(page, config, logger) {
  const beforeState = await readDomFeedState(page, { groupUrl: config.groupUrl });

  await dismissPotentialOverlays(page);
  await prepareDomExtraction(page);
  await recoverFeedContextIfNavigated(page, config, logger);
  await nudgeDomFeed(page, { groupUrl: config.groupUrl });
  await recoverFeedContextIfNavigated(page, config, logger);
  await page.waitForTimeout(250).catch(() => {});
  await page.mouse.wheel(0, 2_600).catch(() => {});
  await page.waitForTimeout(250).catch(() => {});
  await page.keyboard.press("PageDown").catch(() => {});
  await page.waitForTimeout(250).catch(() => {});
  await page
    .evaluate(() => {
      window.scrollBy(0, Math.max(window.innerHeight * 1.5, 1600));
      document.scrollingElement?.scrollBy?.(0, Math.max(window.innerHeight * 1.5, 1600));
    })
    .catch(() => {});
  await page.waitForTimeout(250).catch(() => {});
  await page.keyboard.press("End").catch(() => {});
  await sleepWithJitter(config.minDelayMs, config.maxDelayMs);
  await dismissPotentialOverlays(page);
  await recoverFeedContextIfNavigated(page, config, logger);

  const afterState = await readDomFeedState(page, { groupUrl: config.groupUrl });
  return {
    beforeCount: beforeState.articleCount,
    afterCount: afterState.articleCount,
    beforeTopLevelCount: beforeState.topLevelCount,
    afterTopLevelCount: afterState.topLevelCount,
    beforeSignature: beforeState.lastSignature,
    afterSignature: afterState.lastSignature,
    increased:
      afterState.topLevelCount > beforeState.topLevelCount ||
      afterState.articleCount > beforeState.articleCount ||
      (afterState.lastSignature && afterState.lastSignature !== beforeState.lastSignature),
  };
}

async function collectNetworkCandidates(networkTap, outputManager, config) {
  const payloads = networkTap.drainRelevantPayloads();
  await outputManager.writePayloadSamples(payloads);

  const candidates = [];
  for (const payload of payloads) {
    candidates.push(...extractStructuredPostsFromPayload(payload, { groupUrl: config.groupUrl }));
  }

  return candidates;
}

async function collectDocumentCandidates(page, config) {
  const html = await page.content();
  return extractStructuredPostsFromDocument(html, { groupUrl: config.groupUrl });
}

function acceptCandidates({ candidates, posts, dedupStore, metrics, config }) {
  const accepted = [];
  const unfilteredAccepted = [];
  let skippedForeignGroup = 0;

  for (const candidate of candidates) {
    const unfilteredNormalized = normalizeCandidate(candidate, config.groupUrl, {
      allowShellPosts: true,
    });
    if (!unfilteredNormalized) {
      continue;
    }

    if (!sameGroupUrl(unfilteredNormalized.groupUrl, config.groupUrl)) {
      skippedForeignGroup += 1;
      continue;
    }

    if (!config.unfilteredDedupStore.has(unfilteredNormalized)) {
      config.unfilteredDedupStore.add(unfilteredNormalized);
      config.unfilteredPosts.push(unfilteredNormalized);
      unfilteredAccepted.push(unfilteredNormalized);
    }

    const normalized = normalizeCandidate(candidate, config.groupUrl);
    if (!normalized || dedupStore.has(normalized)) {
      continue;
    }

    dedupStore.add(normalized);
    posts.push(normalized);
    accepted.push(normalized);
    metrics.recordAccepted(normalized);

    if (posts.length >= config.maxPosts) {
      break;
    }
  }

  return {
    accepted,
    unfilteredAccepted,
    skippedForeignGroup,
  };
}

async function persistRunState({ config, posts, unfilteredPosts, outputManager, metrics, networkTap }) {
  const stats = metrics.snapshot({
    uniquePosts: posts.length,
    networkStats: networkTap.getStats(),
  });
  stats.unfilteredUniquePosts = unfilteredPosts.length;
  const checkpoint = buildCheckpoint({
    config,
    posts,
    unfilteredPosts,
    stats,
  });

  await outputManager.writePostsJson(posts, unfilteredPosts);
  await outputManager.writeStats(stats);
  if (typeof outputManager.writeCheckpoint === "function") {
    await outputManager.writeCheckpoint(checkpoint);
  }

  return stats;
}

function reachedRuntimeLimit(config, startedAtMs) {
  if (config.runtimeMinutes == null) {
    return false;
  }

  const runtimeLimitMs = minutesToMs(config.runtimeMinutes);
  return elapsedMs(startedAtMs) >= runtimeLimitMs;
}

export function shouldRecycleBrowser(config, networkTap) {
  if (config.cookiesFile) {
    return false;
  }

  return networkTap.getStats().totalRequests >= config.browserRecycleRequests;
}

export function shouldRecycleOnNetworkStall(config) {
  return !config.cookiesFile;
}

function shouldRotateProxy(config, reason) {
  if (reason === "startup-retry") {
    return config.proxyRotateOnRetry;
  }

  if (reason === "browser-recycle" || reason === "network-stall") {
    return config.proxyRotateOnRecycle;
  }

  if (reason === "blocked-during-run") {
    return config.proxyRotateOnBlock;
  }

  return false;
}

function sanitizeStoredPosts(rawPosts, groupUrl, options = {}) {
  const sanitized = [];
  const dedupStore = new DedupStore();

  for (const post of Array.isArray(rawPosts) ? rawPosts : []) {
    const normalized = normalizeCandidate(post, groupUrl, options);
    if (!normalized || dedupStore.has(normalized)) {
      continue;
    }

    dedupStore.add(normalized);
    sanitized.push(normalized);
  }

  return sanitized;
}

function createProxySessionId(sequence = 1) {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `fbgrp_${sequence}_${Date.now().toString(36)}_${randomPart}`;
}

async function acquireApifyProxy(config, state, reason) {
  if (!config.apifyProxyConfiguration) {
    return null;
  }

  const shouldRotate = !state.sessionId || shouldRotateProxy(config, reason);
  if (shouldRotate) {
    state.sequence += 1;
    state.sessionId = createProxySessionId(state.sequence);
  }

  const proxyUrl = await config.apifyProxyConfiguration.newUrl(state.sessionId);
  if (!proxyUrl) {
    return null;
  }

  const normalized = normalizeProxyConfig({ server: proxyUrl }, "http");
  if (!normalized) {
    return null;
  }

  return {
    ...normalized,
    _selection: {
      mode: "apify",
      reason,
      sessionId: state.sessionId,
    },
  };
}

export async function runScraper(config, outputManager, logger) {
  const checkpoint = config.resume ? await loadCheckpoint(config.outputDir) : null;
  const checkpointMatchesGroup =
    checkpoint?.groupUrl == null || sameGroupUrl(checkpoint.groupUrl, config.groupUrl);
  if (config.resume && checkpoint && !checkpointMatchesGroup) {
    logger.warn({
      event: "checkpoint-group-mismatch",
      checkpointGroupUrl: checkpoint.groupUrl,
      requestedGroupUrl: config.groupUrl,
      outputDir: config.outputDir,
    });
  }

  const posts = checkpointMatchesGroup
    ? sanitizeStoredPosts(checkpoint?.posts, config.groupUrl)
    : [];
  const unfilteredPosts = checkpointMatchesGroup
    ? sanitizeStoredPosts(
        Array.isArray(checkpoint?.unfilteredPosts) ? checkpoint.unfilteredPosts : checkpoint?.posts,
        config.groupUrl,
        { allowShellPosts: true },
      )
    : [...posts];
  const dedupStore = new DedupStore(posts);
  const unfilteredDedupStore = new DedupStore(unfilteredPosts);
  const metrics = new MetricsTracker(posts.length);
  const startedAtMs = Date.now();
  const archivedNetworkStats = {
    totalRequests: 0,
    totalResponses: 0,
    relevantResponses: 0,
    failedRequests: 0,
  };
  let noNewCycles = 0;
  let session = null;
  let networkTap = null;
  let currentProxy = null;
  let currentProxyAcceptedPosts = 0;
  let currentSessionBootstrapped = false;
  let currentSessionLoadedState = false;
  const apifyProxyState = {
    sessionId: null,
    sequence: 0,
  };
  const proxyPool = await ProxyPool.create(config, logger);
  const sessionStateStore = await SessionStateStore.create(config, logger);
  const maxStartupAttempts =
    proxyPool?.hasProxies() && config.proxyRotateOnRetry
      ? Math.max(config.startupRetries + 1, proxyPool.proxies.length)
      : config.startupRetries + 1;
  let blockedSessionRotations = 0;
  let networkStallCycles = 0;
  let networkStallRestarts = 0;
  const maxBlockedSessionRotations = Math.max(config.startupRetries + 1, proxyPool?.proxies.length ?? 0);

  await outputManager.resetPosts(posts, unfilteredPosts);

  const buildNetworkSnapshot = () => {
    const current = networkTap?.getStats() ?? {
      totalRequests: 0,
      totalResponses: 0,
      relevantResponses: 0,
      failedRequests: 0,
    };

    return {
      totalRequests: archivedNetworkStats.totalRequests + current.totalRequests,
      totalResponses: archivedNetworkStats.totalResponses + current.totalResponses,
      relevantResponses: archivedNetworkStats.relevantResponses + current.relevantResponses,
      failedRequests: archivedNetworkStats.failedRequests + current.failedRequests,
    };
  };

  const archiveCurrentNetworkStats = () => {
    const current = networkTap?.getStats();
    if (!current) {
      return;
    }

    archivedNetworkStats.totalRequests += current.totalRequests;
    archivedNetworkStats.totalResponses += current.totalResponses;
    archivedNetworkStats.relevantResponses += current.relevantResponses;
    archivedNetworkStats.failedRequests += current.failedRequests;
  };

  const startSession = async (reason = "initial") => {
    const selectedProxy =
      proxyPool?.acquire({
        reason,
        forceRotate: shouldRotateProxy(config, reason),
      }) ??
      (config.apifyProxyConfiguration
        ? await acquireApifyProxy(config, apifyProxyState, reason)
        : config.proxy);

    if (config.apifyProxyConfiguration && !selectedProxy) {
      throw new Error("Apify proxy configuration did not return a usable proxy URL.");
    }

    currentProxy = selectedProxy;
    currentProxyAcceptedPosts = 0;
    currentSessionBootstrapped = false;
    currentSessionLoadedState = false;
    const loadedSessionState = await sessionStateStore?.load(selectedProxy);
    currentSessionLoadedState = Boolean(loadedSessionState);

    session = await launchBrowserSession(config, logger, selectedProxy, loadedSessionState);
    const warmupResult = await warmupFacebookSession(session, config, logger);
    currentSessionBootstrapped = warmupResult?.bootstrapped === true;
    networkTap = new NetworkTap(logger);
    networkTap.attach(session.page);
    await navigateToGroup(session.page, config.groupUrl);
    await sleepWithJitter(config.minDelayMs, config.maxDelayMs);
  };

  const trackAcceptedPosts = (acceptedPosts) => {
    currentProxyAcceptedPosts += Array.isArray(acceptedPosts) ? acceptedPosts.length : 0;
  };

  const persistCurrentSessionState = async (details = {}) => {
    if (!sessionStateStore || !session?.context || !currentSessionBootstrapped) {
      return;
    }

    await sessionStateStore.save(session.context, currentProxy, {
      posts: details.posts ?? currentProxyAcceptedPosts,
      reason: details.reason ?? "usable-session",
      bootstrapped: currentSessionBootstrapped,
      loadedFromState: currentSessionLoadedState,
      force: details.force === true,
    });
  };

  const finalizeProxySession = (details = {}) => {
    if (!proxyPool?.hasProxies() || !currentProxy) {
      currentProxy = null;
      currentProxyAcceptedPosts = 0;
      currentSessionBootstrapped = false;
      currentSessionLoadedState = false;
      return;
    }

    if (details.reason) {
      proxyPool.reportFailure(currentProxy, {
        reason: details.reason,
        posts: details.posts ?? currentProxyAcceptedPosts,
      });
    } else if (currentProxyAcceptedPosts >= config.proxyLowYieldPostThreshold) {
      proxyPool.reportSuccess(currentProxy, {
        reason: details.successReason ?? "usable-session",
        posts: currentProxyAcceptedPosts,
      });
    } else if (currentProxyAcceptedPosts > 0) {
      proxyPool.reportFailure(currentProxy, {
        reason: "low-yield",
        posts: currentProxyAcceptedPosts,
      });
    }

    currentProxy = null;
    currentProxyAcceptedPosts = 0;
    currentSessionBootstrapped = false;
    currentSessionLoadedState = false;
  };

  try {
    let accepted = [];
    let initialBlockState = null;
    const acceptConfig = {
      ...config,
      unfilteredPosts,
      unfilteredDedupStore,
    };
    const bootstrapFreshSession = async (reason) => {
      await startSession(reason);
      await settleStartupPage(session.page, config);

      const freshCandidates = [
        ...(await collectDocumentCandidates(session.page, config)),
        ...(await collectNetworkCandidates(networkTap, outputManager, config)),
      ];

      let {
        accepted: freshAccepted,
        unfilteredAccepted: freshUnfilteredAccepted,
        skippedForeignGroup,
      } = acceptCandidates({
        candidates: freshCandidates,
        posts,
        dedupStore,
        metrics,
        config: acceptConfig,
      });

      if (skippedForeignGroup > 0) {
        logger.info({
          event: "skipped-foreign-group-posts",
          count: skippedForeignGroup,
          requestedGroupUrl: config.groupUrl,
        });
      }

      if (!freshAccepted.length) {
        const domResult = acceptCandidates({
          candidates: await extractDomPosts(session.page, { groupUrl: config.groupUrl }),
          posts,
          dedupStore,
          metrics,
          config: acceptConfig,
        });
        freshAccepted = domResult.accepted;
        freshUnfilteredAccepted = [
          ...freshUnfilteredAccepted,
          ...domResult.unfilteredAccepted.filter((post) => !freshUnfilteredAccepted.some((item) => item.id === post.id && item.url === post.url)),
        ];
      }

      await outputManager.appendPosts(freshAccepted, freshUnfilteredAccepted);
      trackAcceptedPosts(freshAccepted);
      if (freshAccepted.length) {
        currentSessionBootstrapped = true;
        await persistCurrentSessionState({
          reason: "bootstrap-accepted-posts",
          posts: currentProxyAcceptedPosts,
        });
      }
      const refreshedStats = await persistRunState({
        config,
        posts,
        unfilteredPosts,
        outputManager,
        metrics,
        networkTap: { getStats: buildNetworkSnapshot },
      });
      printProgress(refreshedStats);

      return {
        accepted: freshAccepted,
      };
    };

    for (let attempt = 0; attempt < maxStartupAttempts; attempt += 1) {
      if (attempt > 0) {
        metrics.recordRetry();
      }

      if (session) {
        archiveCurrentNetworkStats();
        networkTap.detach();
        await closeBrowserSession(session);
        session = null;
        networkTap = null;
      }

      try {
        const initialResult = await bootstrapFreshSession(attempt > 0 ? "startup-retry" : "initial");
        accepted = initialResult.accepted;

        initialBlockState = await detectBlockState(session.page);
        if (accepted.length > 0 || !initialBlockState.blocked) {
          break;
        }

        const blockedProxy = currentProxy;
        if (
          sessionStateStore &&
          config.sessionStateResetOnBlock &&
          (initialBlockState.reason === "redirected-to-login" || initialBlockState.reason === "facebook-login-wall")
        ) {
          await sessionStateStore.clear(blockedProxy, initialBlockState.reason);
        }
        finalizeProxySession({
          reason:
            initialBlockState.reason === "redirected-to-login" ? "redirected-to-login" : "login-wall",
        });

        logger.info({
          event: "startup-retry",
          attempt: attempt + 1,
          maxAttempts: maxStartupAttempts,
          reason: initialBlockState.reason,
          snapshot: initialBlockState.snapshot,
        });
      } catch (error) {
        const retriable = isRetriableProxyError(error);
        logger.warn({
          event: "startup-error",
          attempt: attempt + 1,
          maxAttempts: maxStartupAttempts,
          retriable,
          error: error instanceof Error ? error.message : String(error),
        });

        if (networkTap) {
          archiveCurrentNetworkStats();
          networkTap.detach();
          networkTap = null;
        }

        if (
          sessionStateStore &&
          config.sessionStateResetOnBlock &&
          !retriable &&
          currentProxy &&
          currentSessionLoadedState
        ) {
          await sessionStateStore.clear(currentProxy, "startup-error");
        }

        await closeBrowserSession(session);
        session = null;
        finalizeProxySession({
          reason: retriable ? "proxy-error" : "blocked",
        });

        if (retriable && attempt + 1 < maxStartupAttempts) {
          continue;
        }

        throw error;
      }
    }

    if (initialBlockState?.blocked && posts.length === 0) {
      await outputManager.captureFailure(session.page, networkTap, "blocked-initial", initialBlockState);
      throw new Error(`Blocked before usable data was exposed: ${initialBlockState.reason}`);
    }

    let stats = await persistRunState({
      config,
      posts,
      unfilteredPosts,
      outputManager,
      metrics,
      networkTap: { getStats: buildNetworkSnapshot },
    });

    while (posts.length < config.maxPosts) {
      if (reachedRuntimeLimit(config, startedAtMs)) {
        logger.info({ event: "stop", reason: "runtime-limit" });
        break;
      }

      if (noNewCycles >= config.noNewPostCycles) {
        logger.info({ event: "stop", reason: "no-new-posts", noNewCycles });
        break;
      }

      metrics.recordCycle();
      const feedAdvance = await advanceFeed(session.page, config, logger);

      const cycleCandidates = collectNetworkCandidates(networkTap, outputManager, config);
      const structuredCandidates = await cycleCandidates;
      let {
        accepted: networkAccepted,
        unfilteredAccepted: newlyUnfilteredAccepted,
        skippedForeignGroup,
      } = acceptCandidates({
        candidates: structuredCandidates,
        posts,
        dedupStore,
        metrics,
        config: acceptConfig,
      });
      if (skippedForeignGroup > 0) {
        logger.info({
          event: "skipped-foreign-group-posts",
          count: skippedForeignGroup,
          requestedGroupUrl: config.groupUrl,
        });
      }

      let newlyAccepted = networkAccepted;
      if (!newlyAccepted.length) {
        const domResult = acceptCandidates({
          candidates: await extractDomPosts(session.page, { groupUrl: config.groupUrl }),
          posts,
          dedupStore,
          metrics,
          config: acceptConfig,
        });
        newlyAccepted = domResult.accepted;
        newlyUnfilteredAccepted = domResult.unfilteredAccepted;
      }

      const hadFreshNetworkProgress = networkAccepted.length > 0;
      networkStallCycles =
        !newlyAccepted.length && !hadFreshNetworkProgress && !feedAdvance.increased ? networkStallCycles + 1 : 0;
      noNewCycles = newlyAccepted.length || feedAdvance.increased ? 0 : noNewCycles + 1;
      if (newlyAccepted.length) {
        blockedSessionRotations = 0;
        networkStallRestarts = 0;
      }
      await outputManager.appendPosts(newlyAccepted, newlyUnfilteredAccepted);
      trackAcceptedPosts(newlyAccepted);
      if (newlyAccepted.length) {
        currentSessionBootstrapped = true;
        await persistCurrentSessionState({
          reason: "accepted-posts",
          posts: currentProxyAcceptedPosts,
        });
      }

      const blockState = await detectBlockState(session.page);
      stats = await persistRunState({
        config,
        posts,
        unfilteredPosts,
        outputManager,
        metrics,
        networkTap: { getStats: buildNetworkSnapshot },
      });
      printProgress(stats);

      if (
        !blockState.blocked &&
        shouldRecycleOnNetworkStall(config) &&
        networkStallCycles >= config.networkStallRecycleCycles &&
        networkStallRestarts < config.maxNetworkStallRestarts
      ) {
        logger.info({
          event: "network-stall-recycle",
          networkStallCycles,
          attempt: networkStallRestarts + 1,
          maxAttempts: config.maxNetworkStallRestarts,
        });
        networkStallRestarts += 1;
        metrics.recordRetry();
        archiveCurrentNetworkStats();
        networkTap.detach();
        await persistCurrentSessionState({
          reason: "network-stall-recycle",
        });
        finalizeProxySession();
        await closeBrowserSession(session);
        session = null;
        networkTap = null;
        noNewCycles = 0;
        networkStallCycles = 0;
        const refreshed = await bootstrapFreshSession("network-stall");
        if (refreshed.accepted.length) {
          blockedSessionRotations = 0;
          networkStallRestarts = 0;
        }
        continue;
      }

      if (blockState.blocked && newlyAccepted.length === 0) {
        await outputManager.captureFailure(session.page, networkTap, "blocked-during-run", blockState);
        if (
          proxyPool?.hasProxies() &&
          config.proxyRotateOnBlock &&
          blockedSessionRotations < maxBlockedSessionRotations
        ) {
          logger.info({
            event: "blocked-session-retry",
            reason: blockState.reason,
            attempt: blockedSessionRotations + 1,
            maxAttempts: maxBlockedSessionRotations,
          });
          blockedSessionRotations += 1;
          metrics.recordRetry();
          await persistRunState({
            config,
            posts,
            unfilteredPosts,
            outputManager,
            metrics,
            networkTap: { getStats: buildNetworkSnapshot },
          });
          archiveCurrentNetworkStats();
          networkTap.detach();
          if (
            sessionStateStore &&
            config.sessionStateResetOnBlock &&
            (blockState.reason === "redirected-to-login" || blockState.reason === "facebook-login-wall")
          ) {
            await sessionStateStore.clear(currentProxy, blockState.reason);
          }
          finalizeProxySession({
            reason: blockState.reason === "redirected-to-login" ? "redirected-to-login" : "blocked",
          });
          await closeBrowserSession(session);
          session = null;
          networkTap = null;
          noNewCycles = 0;
          await startSession("blocked-during-run");
          continue;
        }

        logger.info({ event: "stop", reason: blockState.reason });
        if (
          sessionStateStore &&
          config.sessionStateResetOnBlock &&
          (blockState.reason === "redirected-to-login" || blockState.reason === "facebook-login-wall")
        ) {
          await sessionStateStore.clear(currentProxy, blockState.reason);
        }
        finalizeProxySession({
          reason: blockState.reason === "redirected-to-login" ? "redirected-to-login" : "blocked",
        });
        break;
      }

      if (posts.length >= config.maxPosts) {
        logger.info({ event: "stop", reason: "max-posts" });
        break;
      }

      if (shouldRecycleBrowser(config, networkTap)) {
        logger.info({
          event: "browser-recycle",
          totalRequests: networkTap.getStats().totalRequests,
        });
        metrics.recordRetry();
        await persistRunState({
          config,
          posts,
          unfilteredPosts,
          outputManager,
          metrics,
          networkTap: { getStats: buildNetworkSnapshot },
        });
        archiveCurrentNetworkStats();
        networkTap.detach();
        await persistCurrentSessionState({
          reason: "browser-recycle",
        });
        finalizeProxySession();
        await closeBrowserSession(session);
        await startSession("browser-recycle");
      }
    }

    await persistCurrentSessionState({
      reason: "run-complete",
    });
    finalizeProxySession();

    const finalStats = await persistRunState({
      config,
      posts,
      unfilteredPosts,
      outputManager,
      metrics,
      networkTap: { getStats: buildNetworkSnapshot },
    });

    if (!posts.length) {
      await outputManager.captureFailure(session.page, networkTap, "no-posts", {
        reason: "No usable posts were extracted from network or DOM sources.",
      });
    }

    if (proxyPool?.hasProxies()) {
      await outputManager.writeDebugJson("proxy-pool-state.json", proxyPool.getStateSnapshot());
    }

    return {
      posts,
      stats: finalStats,
    };
  } catch (error) {
    metrics.recordFailure();
    if (session?.page) {
      await outputManager.captureFailure(session.page, networkTap, "run-error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (
      sessionStateStore &&
      config.sessionStateResetOnBlock &&
      !isRetriableProxyError(error) &&
      currentProxy &&
      currentSessionLoadedState
    ) {
      await sessionStateStore.clear(currentProxy, "run-error");
    }
    finalizeProxySession({
      reason: isRetriableProxyError(error) ? "proxy-error" : undefined,
    });

    if (networkTap) {
      archiveCurrentNetworkStats();
      await persistRunState({
        config,
        posts,
        unfilteredPosts,
        outputManager,
        metrics,
        networkTap: { getStats: () => archivedNetworkStats },
      });
    }

    throw error;
  } finally {
    if (networkTap) {
      networkTap.detach();
    }

    if (proxyPool?.hasProxies()) {
      await outputManager
        .writeDebugJson("proxy-pool-state.json", proxyPool.getStateSnapshot())
        .catch(() => {});
    }

    await closeBrowserSession(session);
  }
}
