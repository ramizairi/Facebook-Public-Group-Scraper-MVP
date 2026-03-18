export function nowIso() {
  return new Date().toISOString();
}

export function minutesToMs(minutes) {
  if (minutes == null) {
    return null;
  }

  return Number(minutes) * 60 * 1000;
}

export function elapsedMs(startedAt) {
  return Date.now() - startedAt;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0s";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours) {
    parts.push(`${hours}h`);
  }

  if (minutes || hours) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${seconds}s`);
  return parts.join(" ");
}
