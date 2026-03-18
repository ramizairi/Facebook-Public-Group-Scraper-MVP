function getTunisDate(dateInput) {
  if (!dateInput) {
    return null;
  }

  const date = new Date(dateInput);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toTunisParts(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tunis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
  };
}

function isoWeekNumber(parts) {
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function deriveCalendarWeek(dateInput) {
  const date = getTunisDate(dateInput);
  if (!date) {
    return null;
  }

  return isoWeekNumber(toTunisParts(date));
}

export function deriveWeekday(dateInput) {
  const date = getTunisDate(dateInput);
  if (!date) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Tunis",
    weekday: "long",
  }).format(date);
}
