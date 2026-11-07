import { useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { ecn, skinClasses } from "@/routes/dashboard/-components/engagement/engagement-tone";

/**
 * Plan-local calendar helpers for the `/engagement` page (D37, D40), plus the
 * day strip on the Past tab.
 *
 * Every "day" here is a plan-local `yyyy-MM-dd` string from the server (`runDate`,
 * history `today`). They are treated as plain calendar dates: arithmetic runs on
 * UTC midnights and labels are formatted with `timeZone: "UTC"`, so the device's
 * own zone can never shift a day. Instants (`completedAt`) are formatted in the
 * plan's IANA zone when the server sends one.
 */

// --- Calendar helpers ---------------------------------------------------------------

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC midnight of a `yyyy-MM-dd` day, or null for anything else. */
function isoDayToUtc(iso: string | null | undefined): Date | null {
  const match = iso ? ISO_DAY.exec(iso) : null;
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcToIsoDay(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** `iso` moved by `days` calendar days. Returns `iso` unchanged when it is not a day. */
export function addIsoDays(iso: string, days: number): string {
  const date = isoDayToUtc(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return utcToIsoDay(date);
}

/**
 * Today in `timeZone` (the plan's zone) as `yyyy-MM-dd`, from the device clock.
 * Only a fallback for servers that do not send `today`; never `toISOString()`,
 * which is the UTC day and is wrong for most of the evening in India.
 */
export function zonedIsoToday(timeZone?: string | null, now: number = Date.now()): string {
  const read = (zone?: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  try {
    return read(timeZone || undefined);
  } catch {
    // An unknown zone name: fall back to the device's own calendar.
    return read(undefined);
  }
}

/** "Fri 25 Sep" in the active UI locale, for a plan-local day. */
export function isoDayShort(iso: string | null | undefined): string {
  const date = isoDayToUtc(iso);
  if (!date) return "";
  return formatDate(date, { weekday: "short", day: "numeric", month: "short", year: undefined, timeZone: "UTC" });
}

/** "Friday, 25 September" in the active UI locale, for a plan-local day. */
export function isoDayLong(iso: string | null | undefined): string {
  const date = isoDayToUtc(iso);
  if (!date) return "";
  return formatDate(date, { weekday: "long", day: "numeric", month: "long", year: undefined, timeZone: "UTC" });
}

/**
 * A day heading relative to the plan's today: "Today", "Yesterday", else
 * "Friday, 25 September". `t` is bound to `dashboardEngagement`.
 */
export function isoDayHeading(iso: string, today: string, t: TFunction): string {
  if (iso === today) return t("page.day.today");
  if (iso === addIsoDays(today, -1)) return t("page.day.yesterday");
  return isoDayLong(iso);
}

/**
 * "Fri 25 Sep, 7:51 PM" for an instant, in the plan's zone when known (so a task
 * done at 11:30 PM IST never reads as the next day on a device set to UTC).
 */
export function formatInstantIn(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return "";
  const options: Intl.DateTimeFormatOptions = { weekday: "short", year: undefined };
  try {
    return formatDateTime(iso, timeZone ? { ...options, timeZone } : options);
  } catch {
    // An unknown zone name: format in the device zone rather than print nothing.
    return formatDateTime(iso, options);
  }
}

// --- Day strip ---------------------------------------------------------------------------

/** How one past day went, for the strip. */
export interface DayTally {
  total: number;
  done: number;
  /** Still inside its catch-up window. */
  catchUp: number;
}

export type DayStatus = "allDone" | "someDone" | "catchable" | "missed" | "none";

export function dayStatusOf(tally: DayTally | undefined): DayStatus {
  if (!tally || tally.total === 0) return "none";
  if (tally.done >= tally.total) return "allDone";
  if (tally.catchUp > 0) return "catchable";
  if (tally.done > 0) return "someDone";
  return "missed";
}

/** Literal classes per status: semantic tokens, play pairs, clay tints. */
const STATUS_CLASSES: Record<DayStatus, string> = {
  allDone: "bg-success-500 [.ui-play_&]:bg-play-success [.ui-cleaner-play_&]:bg-cp-sage",
  someDone: "bg-success-200 [.ui-play_&]:bg-play-success-soft [.ui-cleaner-play_&]:bg-cp-sage-tint",
  catchable:
    "bg-warning-300 [.ui-play_&]:bg-play-warn [.ui-cleaner-play_&]:bg-cp-gold",
  missed: "bg-danger-200 [.ui-play_&]:bg-play-danger-soft [.ui-cleaner-play_&]:bg-cp-terracotta-tint",
  none: "bg-muted [.ui-play_&]:bg-play-surface [.ui-cleaner-play_&]:bg-cp-bg-deep",
};

const LEGEND: DayStatus[] = ["allDone", "someDone", "catchable", "missed", "none"];

export interface DayStripProps {
  /** Plan-local today (`yyyy-MM-dd`). The strip ends on the day before it. */
  today: string;
  /** How many days to draw (capped at 30). */
  days: number;
  tallies: Map<string, DayTally>;
  className?: string;
}

/**
 * The last N days at a glance, oldest first, ending yesterday (D37). Colour is
 * never the only signal: each day carries a screen-reader sentence, and the
 * legend names every colour.
 */
export function DayStrip({ today, days, tallies, className }: DayStripProps) {
  const { t } = useTranslation("dashboardEngagement");
  const count = Math.max(1, Math.min(30, days));

  const cells = useMemo(() => {
    const out: { iso: string; status: DayStatus; tally?: DayTally }[] = [];
    for (let offset = count; offset >= 1; offset--) {
      const iso = addIsoDays(today, -offset);
      const tally = tallies.get(iso);
      out.push({ iso, status: dayStatusOf(tally), tally });
    }
    return out;
  }, [count, today, tallies]);

  // A day counts as active when anything was finished, even if a task is still catchable.
  const activeDays = cells.filter((c) => (c.tally?.done ?? 0) > 0).length;
  const first = cells[0]?.iso ?? today;
  const last = cells[cells.length - 1]?.iso ?? today;

  return (
    <section
      aria-label={t("page.strip.title", { count })}
      className={ecn("flex min-w-0 flex-col gap-2", className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={ecn("text-caption font-semibold", skinClasses("ink"))}>
          {t("page.strip.title", { count })}
        </h3>
        <p className={ecn("text-caption tabular-nums", skinClasses("mutedInk"))}>
          {t("page.strip.activeDays", { count: activeDays, total: count })}
        </p>
      </div>
      <ol className="flex min-w-0 items-stretch gap-0.5 sm:gap-1">
        {cells.map((cell) => {
          const label = isoDayShort(cell.iso);
          const sentence = cell.tally
            ? t(`page.strip.cell.${cell.status}`, {
                date: label,
                done: cell.tally.done,
                total: cell.tally.total,
              })
            : t("page.strip.cell.none", { date: label });
          return (
            <li
              key={cell.iso}
              title={sentence}
              className={ecn(
                "h-7 min-w-0 flex-1 rounded-sm first:rounded-s-md last:rounded-e-md",
                STATUS_CLASSES[cell.status]
              )}
            >
              <span className="sr-only">{sentence}</span>
            </li>
          );
        })}
      </ol>
      <div className={ecn("flex justify-between gap-3 text-caption", skinClasses("mutedInk"))}>
        <span>{isoDayShort(first)}</span>
        <span>{isoDayShort(last)}</span>
      </div>
      <ul aria-hidden className="flex flex-wrap gap-x-4 gap-y-1">
        {LEGEND.map((status) => (
          <li key={status} className={ecn("inline-flex items-center gap-1.5 text-caption", skinClasses("mutedInk"))}>
            <span className={ecn("size-2.5 shrink-0 rounded-sm", STATUS_CLASSES[status])} />
            {t(`page.strip.legend.${status}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}
