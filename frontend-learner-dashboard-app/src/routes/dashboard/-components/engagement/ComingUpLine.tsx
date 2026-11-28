import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { LockSimple, type Icon } from "@phosphor-icons/react";
import type { EngagementItem } from "@/services/engagement";
import { formatRelative, getActiveLocale } from "@/lib/formatters";
import { shortDateLabel, visualFor } from "./engagement-visuals";
import { maxPoints } from "./engagement-copy";
import { ecn, skinClasses, toneClasses } from "./engagement-tone";

/**
 * "Tomorrow · unlocks 7:00 AM · [icons] · 2 tasks · +50 pts" (D36).
 *
 * The locked future tasks, grouped by run date into ONE line for the nearest
 * day. Later days live on the `/engagement` page. The icons are decorative; an
 * sr-only sentence carries the same facts. Dates and times go through the
 * active locale (no English dates in Arabic or Hindi).
 */

export interface ComingUpGroup {
  runDate: string;
  count: number;
  /** Distinct type icons, at most 3, in first-seen order. */
  icons: { key: string; icon: Icon; tone: ReturnType<typeof visualFor>["tone"] }[];
  points: number;
  /** Earliest unlock time in the group (ISO), when the server sent one. */
  opensAt: string | null;
}

/** Group locked tasks by run date, nearest first. Pure. */
export function groupComingUp(upcoming: EngagementItem[], maxDays = 3): ComingUpGroup[] {
  const byDate = new Map<string, ComingUpGroup>();
  for (const item of upcoming) {
    const runDate = item.runDate ?? "";
    if (!runDate) continue;
    let group = byDate.get(runDate);
    if (!group) {
      group = { runDate, count: 0, icons: [], points: 0, opensAt: null };
      byDate.set(runDate, group);
    }
    group.count++;
    group.points += maxPoints(item);
    const visual = visualFor(item);
    const key = `${visual.label}:${visual.icon.displayName ?? ""}`;
    if (group.icons.length < 3 && !group.icons.some((i) => i.key === key)) {
      group.icons.push({ key, icon: visual.icon, tone: visual.tone });
    }
    const opens = item.opensAt ? Date.parse(item.opensAt) : NaN;
    if (Number.isFinite(opens) && (group.opensAt == null || opens < Date.parse(group.opensAt))) {
      group.opensAt = item.opensAt ?? null;
    }
  }
  return [...byDate.values()].sort((a, b) => a.runDate.localeCompare(b.runDate)).slice(0, maxDays);
}

function dayNumber(isoDate: string): number | null {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function capitalize(text: string): string {
  if (!text) return text;
  try {
    return text.charAt(0).toLocaleUpperCase(getActiveLocale()) + text.slice(1);
  } catch {
    return text;
  }
}

/**
 * "Later today", "Tomorrow" (locale words), else "Sat 27 Sep". `todayKey` is the
 * plan-local today; without it the device date is used.
 */
export function dayLabel(runDate: string, todayKey: string | null, t: TFunction): string {
  const today = dayNumber(todayKey ?? localToday());
  const day = dayNumber(runDate);
  if (today != null && day != null) {
    const diff = day - today;
    if (diff === 0) return t("today.comingUp.laterToday");
    if (diff === 1) {
      const base = Date.UTC(2000, 0, 1);
      return capitalize(formatRelative(base + 86_400_000, base));
    }
  }
  return shortDateLabel(runDate);
}

function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "7:00 AM" in the active locale; "" when unknown. */
export function timeOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(getActiveLocale(), { hour: "numeric", minute: "2-digit" }).format(ms);
  } catch {
    return "";
  }
}

export interface ComingUpLineProps {
  upcoming: EngagementItem[];
  todayKey: string | null;
  /** The server capped today's list: "More unlock as you finish." */
  capped?: boolean;
  showPoints?: boolean;
  /** Rail: one truncated line without the type icons and points. */
  compact?: boolean;
  className?: string;
}

export function ComingUpLine({
  upcoming,
  todayKey,
  capped = false,
  showPoints = true,
  compact = false,
  className,
}: ComingUpLineProps) {
  const { t } = useTranslation("dashboardEngagement");
  const group = groupComingUp(upcoming, 1)[0];
  if (!group && !capped) return null;

  const inkMuted = skinClasses("mutedInk");
  return (
    <div className={ecn("flex min-w-0 flex-col gap-1 text-caption", inkMuted, className)}>
      {capped && <p>{t("today.capped")}</p>}
      {group && (
        <p
          // Always one line (D36): the icons drop below sm and the tail truncates.
          className="flex min-w-0 flex-nowrap items-center gap-x-1.5 overflow-hidden whitespace-nowrap"
        >
          <span className="sr-only">
            {t("today.comingUp.aria", {
              day: dayLabel(group.runDate, todayKey, t),
              count: group.count,
              time: timeOnly(group.opensAt) || t("today.comingUp.soon"),
            })}
          </span>
          <LockSimple aria-hidden className="size-3.5 shrink-0" />
          <span aria-hidden className={ecn("shrink-0 font-medium", skinClasses("ink"))}>
            {dayLabel(group.runDate, todayKey, t)}
          </span>
          {group.opensAt && timeOnly(group.opensAt) && (
            <span aria-hidden className="shrink-0">
              {"· "}
              {t("today.comingUp.unlocks", { time: timeOnly(group.opensAt) })}
            </span>
          )}
          <span aria-hidden>·</span>
          <span aria-hidden className={ecn("hidden items-center gap-0.5", !compact && "sm:inline-flex")}>
            {group.icons.map(({ key, icon: TypeIcon, tone }) => (
              <TypeIcon key={key} weight="duotone" className={ecn("size-3.5", toneClasses(tone, "icon"))} />
            ))}
          </span>
          <span aria-hidden className="min-w-0 truncate">
            {t("today.comingUp.tasks", { count: group.count })}
            {showPoints && !compact && group.points > 0 && (
              // Phones keep the line whole by dropping the points, never truncating them.
              <span className="hidden tabular-nums sm:inline">
                {" · "}
                <span className="[.ui-play_&]:hidden [.ui-cleaner-play_&]:hidden">
                  {t("badge.pts", { count: group.points })}
                </span>
                <span className="hidden [.ui-play_&]:inline [.ui-cleaner-play_&]:inline">
                  {t("badge.xp", { count: group.points })}
                </span>
              </span>
            )}
          </span>
        </p>
      )}
    </div>
  );
}
