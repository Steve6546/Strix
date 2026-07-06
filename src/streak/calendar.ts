import type { GuildSettings } from "@prisma/client";

export function getDayKey(date: Date, settings: Pick<GuildSettings, "mode" | "resetTime" | "timezone">): string {
  if (settings.mode === "ROLLING_24H") {
    return formatDateInTimezone(date, settings.timezone);
  }

  const [hour, minute] = settings.resetTime.split(":").map(Number);
  const zoned = getZonedParts(date, settings.timezone);
  const resetBoundary = new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day, hour || 0, minute || 0));
  const currentComparable = new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute));

  if (currentComparable < resetBoundary) {
    const previous = new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day - 1));
    return formatDateInTimezone(previous, "UTC");
  }

  return `${zoned.year}-${pad(zoned.month)}-${pad(zoned.day)}`;
}

export function previousDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return date.toISOString().slice(0, 10);
}

function formatDateInTimezone(date: Date, timezone: string): string {
  const parts = getZonedParts(date, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function getZonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
