import { buildCheckpoint, loadCheckpoint, persistCheckpoint } from "./checkpoint.js";
import { DedupStore } from "./dedup-store.js";
import { detectBlockState } from "./block-detection.js";
import { MetricsTracker } from "./metrics.js";
import { normalizeCandidate } from "./normalize.js";
import { isRetriableProxyError } from "../browser/proxy-errors.js";
import { ProxyPool } from "../browser/proxy-pool.js";
import { closeBrowserSession, launchBrowserSession } from "../browser/session.js";
import { warmupFacebookSession } from "../browser/warmup.js";
import { sleepWithJitter } from "../utils/delay.js";
import { sameGroupUrl } from "../utils/facebook-url.js";
import { elapsedMs, minutesToMs } from "../utils/time.js";
import { NetworkTap } from "../extract/network-tap.js";
import { extractDomPosts } from "../extract/dom-fallback.js";
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

  await outputManager.writePostsJson(posts, unfilteredPosts);
  await outputManager.writeStats(stats);
  await persistCheckpoint(
    config.outputDir,
    buildCheckpoint({
      config,
      posts,
      unfilteredPosts,
      stats,
    }),
  );

  return stats;
}

function reachedRuntimeLimit(config, startedAtMs) {
  if (config.runtimeMinutes == null) {
    return false;
  }

  const runtimeLimitMs = minutesToMs(config.runtimeMinutes);
  return elapsedMs(startedAtMs) >= runtimeLimitMs;
}

function shouldRecycleBrowser(config, networkTap) {
  return networkTap.getStats().totalRequests >= config.browserRecycleRequests;
}

function shouldRotateProxy(config, reason) {
  if (reason === "startup-retry") {
    return config.proxyRotateOnRetry;
  }

  if (reason === "browser-recycle") {
    return config.proxyRotateOnRecycle;
  }

  if (reason === "blocked-during-run") {
    return config.proxyRotateOnBlock;
  }

  return false;
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

  const posts =
    Array.isArray(checkpoint?.posts) && checkpointMatchesGroup ? [...checkpoint.posts] : [];
  const unfilteredPosts =
    Array.isArray(checkpoint?.unfilteredPosts) && checkpointMatchesGroup
      ? [...checkpoint.unfilteredPosts]
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
  const proxyPool = await ProxyPool.create(config, logger);
  const maxStartupAttempts =
    proxyPool?.hasProxies() && config.proxyRotateOnRetry
      ? Math.max(config.startupRetries + 1, proxyPool.proxies.length)
      : config.startupRetries + 1;
  let blockedSessionRotations = 0;
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
      }) ?? config.proxy;

    session = await launchBrowserSession(config, logger, selectedProxy);
    await warmupFacebookSession(session, config, logger);
    networkTap = new NetworkTap(logger);
    networkTap.attach(session.page);
    await navigateToGroup(session.page, config.groupUrl);
    await sleepWithJitter(config.minDelayMs, config.maxDelayMs);
  };

  try {
    let accepted = [];
    let initialBlockState = null;
    const acceptConfig = {
      ...config,
      unfilteredPosts,
      unfilteredDedupStore,
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
        await startSession(attempt > 0 ? "startup-retry" : "initial");
        await settleStartupPage(session.page, config);

        const initialCandidates = [
          ...(await collectDocumentCandidates(session.page, config)),
          ...(await collectNetworkCandidates(networkTap, outputManager, config)),
        ];

        const initialResult = acceptCandidates({
          candidates: initialCandidates,
          posts,
          dedupStore,
          metrics,
          config: acceptConfig,
        });
        accepted = initialResult.accepted;

        if (initialResult.skippedForeignGroup > 0) {
          logger.info({
            event: "skipped-foreign-group-posts",
            count: initialResult.skippedForeignGroup,
            requestedGroupUrl: config.groupUrl,
          });
        }

        if (!accepted.length) {
          const domResult = acceptCandidates({
            candidates: await extractDomPosts(session.page, { groupUrl: config.groupUrl }),
            posts,
            dedupStore,
            metrics,
            config: acceptConfig,
          });
          accepted = domResult.accepted;
          await outputManager.appendPosts([], domResult.unfilteredAccepted);
        }

        await outputManager.appendPosts(accepted, initialResult.unfilteredAccepted);
        const stats = await persistRunState({
          config,
          posts,
          unfilteredPosts,
          outputManager,
          metrics,
          networkTap: { getStats: buildNetworkSnapshot },
        });
        printProgress(stats);

        initialBlockState = await detectBlockState(session.page);
        if (accepted.length > 0 || !initialBlockState.blocked) {
          break;
        }

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

        await closeBrowserSession(session);
        session = null;

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
      await session.page.mouse.wheel(0, 2_400);
      await sleepWithJitter(config.minDelayMs, config.maxDelayMs);

      const cycleCandidates = collectNetworkCandidates(networkTap, outputManager, config);
      const structuredCandidates = await cycleCandidates;
      let {
        accepted: newlyAccepted,
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

      noNewCycles = newlyAccepted.length ? 0 : noNewCycles + 1;
      if (newlyAccepted.length) {
        blockedSessionRotations = 0;
      }
      await outputManager.appendPosts(newlyAccepted, newlyUnfilteredAccepted);

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
          await closeBrowserSession(session);
          session = null;
          networkTap = null;
          noNewCycles = 0;
          await startSession("blocked-during-run");
          continue;
        }

        logger.info({ event: "stop", reason: blockState.reason });
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
        await closeBrowserSession(session);
        await startSession("browser-recycle");
      }
    }

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

    await closeBrowserSession(session);
  }
}
