/** Small presentation helpers shared across chat components. */

/**
 * Chat timestamps are recorded in UTC, but service builds before the Instant switch serialise
 * them without a zone marker — and `new Date("2026-08-19T08:47:03")` reads a bare value as
 * *local* time, so a 2:17 PM IST message rendered as 8:47 AM. Force UTC when the marker is
 * missing; values that already carry one (including our optimistic `toISOString()` echoes)
 * pass through untouched.
 */
export function toUtcDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const hasZone = /Z$|[+-]\d{2}:?\d{2}$/i.test(raw);
  const d = new Date(hasZone ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Returns a YYYY-MM-DD day key for grouping messages into day buckets. */
export function dayKey(iso: string): string {
  const d = toUtcDate(iso);
  if (!d) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Human-friendly day label: "Today", "Yesterday", or a full date.
 *
 * This is a plain (non-hook) helper, so it can't call `useTranslation` itself —
 * the caller passes its already-resolved `t()` labels for the two relative-day
 * strings; everything else (the full-date fallback) is locale-formatted via `Intl`.
 */
export function dayLabel(
  iso: string,
  labels?: { today: string; yesterday: string },
): string {
  const d = toUtcDate(iso);
  if (!d) return "";
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return labels?.today ?? "Today";
  if (diffDays === 1) return labels?.yesterday ?? "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * Formats on a 12-hour dial and uppercases the AM/PM marker. Without `hour12` a browser
 * reporting en-GB renders "14:16", and en-GB/en-IN both spell the marker lowercase ("pm"),
 * so the clock would read differently for each learner depending on their locale.
 * `locale` is for tests; the UI passes none and follows the browser.
 */
export function formatClockTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .formatToParts(date)
    .map((part) => (part.type === "dayPeriod" ? part.value.toUpperCase() : part.value))
    .join("");
}

/** Short clock time for a message bubble, e.g. "3:07 PM". */
export function timeLabel(iso: string): string {
  const d = toUtcDate(iso);
  return d ? formatClockTime(d) : "";
}

/** Initials for an avatar fallback. */
export function initialsOf(name?: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Returns true when the URL/mime points at an image we can inline-render. */
export function isImageAttachment(mime?: string, url?: string): boolean {
  if (mime?.startsWith("image/")) return true;
  if (!url) return false;
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url);
}
