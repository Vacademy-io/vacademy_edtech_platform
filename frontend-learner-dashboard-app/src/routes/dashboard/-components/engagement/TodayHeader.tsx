import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { CalendarCheck, CaretRight, Fire, type IconWeight } from "@phosphor-icons/react";
import type { PointsSummary } from "@/services/points";
import { ecn, skinClasses } from "./engagement-tone";
import { formatClock } from "./engagement-copy";
import { SegmentedProgress } from "./SegmentedProgress";

/**
 * The Today module's header (D5, D9, D50, D53):
 * - "Today", "3 of 9" and "Open" (to `/engagement`);
 * - with gamification on: "+40 of 170 pts" (XP in the play skins), and below
 *   sm also the running total ("217 total"), which pops when it moves;
 * - the deadline every open task shares, once ("Closes 9:00 PM");
 * - the segmented progress for today's scheduled tasks;
 * - the streak, only in default / vibrant / corporate (the play heroes show
 *   their own), with the same server value everywhere.
 */

export interface TodayHeaderProps {
  headingId: string;
  headingRef?: Ref<HTMLHeadingElement>;
  scheduled: number;
  completed: number;
  requiredDone?: number;
  requiredOpen?: number;
  /** Earned today / reachable today; `total` is omitted when nothing is left to earn. */
  points?: { earned: number; total: number | null } | null;
  /** The server points summary (total + streak), when gamification is on. */
  summary?: PointsSummary | null;
  sharedDeadline?: string | null;
  now: number;
  onOpenPage: () => void;
  /** Hide the progress row (all-done and nothing-today states say it themselves). */
  hideProgress?: boolean;
  /** Main slot: from sm up, points / deadline / streak share the title row. */
  inline?: boolean;
  /**
   * Rail slot: below xl the rail can be under 200 px wide, so "Open" shrinks to
   * its arrow and the streak moves down to the points line.
   */
  compact?: boolean;
  iconWeight?: IconWeight;
  className?: string;
}

function PtsOrXp({ pts, xp }: { pts: string; xp: string }) {
  return (
    <>
      <span className="[.ui-play_&]:hidden [.ui-cleaner-play_&]:hidden">{pts}</span>
      <span className="hidden [.ui-play_&]:inline [.ui-cleaner-play_&]:inline">{xp}</span>
    </>
  );
}

export function TodayHeader({
  headingId,
  headingRef,
  scheduled,
  completed,
  requiredDone = 0,
  requiredOpen = 0,
  points,
  summary,
  sharedDeadline,
  now,
  onOpenPage,
  hideProgress = false,
  inline = false,
  compact = false,
  iconWeight = "duotone",
  className,
}: TodayHeaderProps) {
  const { t } = useTranslation("dashboardEngagement");
  const muted = skinClasses("mutedInk");
  const deadline = sharedDeadline ? formatClock(sharedDeadline, now) : "";
  const streak = summary?.currentStreak;
  const totalPoints = summary?.totalPoints;

  const kept = typeof streak === "number" && streak > 0 && summary?.keptToday === true;
  const streakLabel =
    typeof streak !== "number"
      ? ""
      : streak <= 0
        ? t("today.streak.none")
        : kept
          ? t("today.streak.kept", { count: streak })
          : t("today.streak.atRisk", { count: streak });
  const hasStreak = typeof streak === "number";
  const hasSecondary = Boolean(points || deadline || (compact && hasStreak));
  // Compact "fire + days" in the title row (the label carries the state for
  // screen readers and on hover). Hidden in the play skins, whose heroes show it.
  const streakNode = (extra?: string) =>
    hasStreak && (
    <span
      title={streakLabel}
      className={ecn(
        "inline-flex shrink-0 items-center gap-0.5 text-caption font-semibold tabular-nums [.ui-cleaner-play_&]:hidden [.ui-play_&]:hidden",
        kept ? "text-warning-700 [.ui-corporate_&]:text-foreground" : muted,
        extra
      )}
    >
      <Fire aria-hidden weight={kept ? "fill" : "regular"} className="size-3.5" />
      <span aria-hidden>{Math.max(0, streak ?? 0)}</span>
      <span className="sr-only">{streakLabel}</span>
    </span>
  );
  const secondary = (extra?: string) => (
    <div className={ecn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption", muted, extra)}>
      {points && (
        <span className="inline-flex items-center gap-1 font-medium tabular-nums">
          {points.total != null && points.total > points.earned ? (
            <PtsOrXp
              pts={t("today.pointsOf", { earned: points.earned, total: points.total })}
              xp={t("today.xpOf", { earned: points.earned, total: points.total })}
            />
          ) : (
            <PtsOrXp
              pts={t("today.pointsToday", { count: points.earned })}
              xp={t("today.xpToday", { count: points.earned })}
            />
          )}
          {/* Below sm the top-bar pill hides its points; the total lives here (D50). */}
          {typeof totalPoints === "number" && (
            <span
              key={totalPoints}
              className={ecn(
                "sm:hidden",
                "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-safe:duration-300"
              )}
            >
              {"· "}
              {t("today.total", { count: totalPoints })}
            </span>
          )}
        </span>
      )}
      {deadline && <span>{t("today.closesAt", { time: deadline })}</span>}
      {compact && streakNode("xl:hidden")}
    </div>
  );

  return (
    <div className={ecn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <CalendarCheck
          aria-hidden
          weight={iconWeight}
          className="size-5 shrink-0 text-primary-500 [.ui-play_&]:text-play-info-deep [.ui-cleaner-play_&]:text-cp-terracotta [.ui-corporate_&]:text-muted-foreground"
        />
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className={ecn("text-title font-semibold focus:outline-none", skinClasses("ink"))}
        >
          {t("today.title")}
        </h2>
        {scheduled > 0 && (
          <span className={ecn("whitespace-nowrap text-body tabular-nums", muted)}>
            {t("today.progress", { done: Math.min(completed, scheduled), total: scheduled })}
          </span>
        )}
        {inline && hasSecondary && secondary("hidden min-w-0 sm:flex")}
        <span className="ms-auto flex shrink-0 items-center gap-2">
          {streakNode(compact ? "hidden xl:inline-flex" : undefined)}
          <button
          type="button"
          onClick={onOpenPage}
          aria-label={t("today.openAria")}
          className={ecn(
            "-me-2 inline-flex min-h-8 shrink-0 items-center gap-0.5 rounded-md px-2 text-body font-medium text-primary-500 hover:bg-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
            "[.ui-play_&]:text-play-info-deep [.ui-cleaner-play_&]:text-cp-ink"
          )}
        >
          <span className={compact ? "hidden xl:inline" : undefined}>{t("today.open")}</span>
          <CaretRight aria-hidden weight="bold" className="size-4 rtl:-scale-x-100" />
          </button>
        </span>
      </div>

      {hasSecondary && secondary(inline ? "sm:hidden" : undefined)}

      {!hideProgress && scheduled > 0 && (
        <SegmentedProgress
          total={scheduled}
          done={completed}
          requiredDone={requiredDone}
          requiredOpen={requiredOpen}
        />
      )}
    </div>
  );
}
