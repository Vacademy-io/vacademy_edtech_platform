import type { TFunction } from "i18next";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The server sends UTC timestamps, sometimes without the trailing "Z". */
export const parseUtc = (iso: string | null): number | null => {
  if (!iso) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso);
  const ms = new Date(hasZone ? iso : `${iso}Z`).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** "Just now", "5m ago", "2h ago", "Yesterday", "3d ago", then a short date. */
export const relativeTime = (iso: string | null, t: TFunction, language: string): string => {
  const ms = parseUtc(iso);
  if (ms === null) return "";
  const diff = Math.max(0, Date.now() - ms);
  if (diff < MINUTE) return t("history.justNow");
  if (diff < HOUR) return t("history.minutesAgo", { n: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t("history.hoursAgo", { n: Math.floor(diff / HOUR) });
  if (diff < 2 * DAY) return t("history.yesterday");
  if (diff < 7 * DAY) return t("history.daysAgo", { n: Math.floor(diff / DAY) });
  return new Date(ms).toLocaleDateString(language, { day: "numeric", month: "short" });
};
