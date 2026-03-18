export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomBetween(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return 0;
  }

  if (max <= min) {
    return Math.max(0, Math.floor(min));
  }

  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function sleepWithJitter(minDelayMs, maxDelayMs) {
  const waitMs = randomBetween(minDelayMs, maxDelayMs);
  if (waitMs > 0) {
    await sleep(waitMs);
  }

  return waitMs;
}
