import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle, LockSimple, Play, XCircle, type Icon } from "@phosphor-icons/react";
import type { EngagementItem } from "@/services/engagement";
import {
  getLatestResume,
  resumeSearchParams,
  RESUME_ROUTE,
  type ResumeEntry,
} from "@/services/resume-thread";
import { celebrate, claimDailyCelebration, type CelebrationSkin } from "@/lib/play-celebration";
import { ecn, outcomeClasses, skinClasses } from "./engagement-tone";
import { outcomeOf, type EngagementOutcome } from "./engagement-copy";
import { timeOnly } from "./ComingUpLine";

/**
 * The all-done state (D19), about 120 px:
 * - "All 9 done · +82 pts today";
 * - "2 answers reveal at 8:00 PM · Next tasks tomorrow, 7:00 AM";
 * - one outcome mark per finished task;
 * - "Keep going: Resume {lesson}", only in the skins whose hero has no resume
 *   CTA (default, vibrant, corporate);
 * - play skins: one milestone celebration per day.
 */

const OUTCOME_ICON: Record<EngagementOutcome, Icon> = {
  correct: CheckCircle,
  wrong: XCircle,
  pending: LockSimple,
  done: CheckCircle,
};

/** Hidden-result answers still waiting, and when the first of them reveals. Pure. */
export function pendingReveals(
  doneToday: EngagementItem[],
  now: number
): { count: number; firstAt: string | null } {
  let count = 0;
  let first: number | null = null;
  let firstAt: string | null = null;
  for (const item of doneToday) {
    if (item.resultPending !== true) continue;
    const at = item.revealAt ? Date.parse(item.revealAt) : NaN;
    if (!Number.isFinite(at) || at <= now) continue;
    count++;
    if (first == null || at < first) {
      first = at;
      firstAt = item.revealAt ?? null;
    }
  }
  return { count, firstAt };
}

export interface TodayCompleteProps {
  total: number;
  doneToday: EngagementItem[];
  /** Points earned today (sum of today's awards). */
  pointsToday: number;
  showPoints?: boolean;
  /** Next locked group, as the Coming up line computed it. */
  next?: { label: string; opensAt: string | null } | null;
  /** This session's outcomes, fresher than the rows. */
  outcomes?: Record<string, EngagementOutcome>;
  celebrationSkin?: CelebrationSkin;
  /** Rail slot: below xl the rail can be under 200 px, so the icon column goes. */
  compact?: boolean;
  now: number;
  className?: string;
}

export function TodayComplete({
  total,
  doneToday,
  pointsToday,
  showPoints = true,
  next,
  outcomes,
  celebrationSkin = "other",
  compact = false,
  now,
  className,
}: TodayCompleteProps) {
  const indent = compact ? "xl:ps-12" : "ps-12";
  const { t } = useTranslation("dashboardEngagement");
  const navigate = useNavigate();
  const [resume] = useState<ResumeEntry | null>(() => getLatestResume());
  const reveals = pendingReveals(doneToday, now);

  // One milestone per day, play skins only (the helper is a no-op elsewhere).
  useEffect(() => {
    if (!showPoints || celebrationSkin === "other") return;
    if (claimDailyCelebration("engagement-all-done")) celebrate("milestone", { skin: celebrationSkin });
  }, [showPoints, celebrationSkin]);

  const lines: string[] = [];
  if (reveals.count > 0 && reveals.firstAt) {
    lines.push(t("today.complete.reveals", { count: reveals.count, time: timeOnly(reveals.firstAt) }));
  }
  if (next) {
    const time = timeOnly(next.opensAt);
    lines.push(
      time
        ? t("today.complete.nextAt", { day: next.label, time })
        : t("today.complete.next", { day: next.label })
    );
  }

  const marks = doneToday.slice(0, 12);

  return (
    <div
      role="status"
      className={ecn(
        "flex min-w-0 flex-col gap-2 rounded-lg p-3",
        outcomeClasses("correct", "option"),
        "border [.ui-corporate_&]:border-border [.ui-corporate_&]:bg-card",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={ecn(
            "size-9 shrink-0 items-center justify-center rounded-full",
            compact ? "hidden xl:flex" : "flex",
            outcomeClasses("correct", "circle"),
            celebrationSkin === "play" && "play-bounce-in"
          )}
        >
          <CheckCircle weight="fill" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={ecn(
              "flex flex-wrap items-baseline gap-x-2 text-subtitle font-semibold",
              skinClasses("ink")
            )}
          >
            <span className="whitespace-nowrap">{t("today.complete.title", { count: total })}</span>
            {showPoints && pointsToday > 0 && (
              <span className={ecn("whitespace-nowrap font-normal tabular-nums", skinClasses("mutedInk"))}>
                <span className="[.ui-play_&]:hidden [.ui-cleaner-play_&]:hidden">
                  {t("today.pointsToday", { count: pointsToday })}
                </span>
                <span className="hidden [.ui-play_&]:inline [.ui-cleaner-play_&]:inline">
                  {t("today.xpToday", { count: pointsToday })}
                </span>
              </span>
            )}
          </p>
          {lines.length > 0 && (
            <p className={ecn("text-caption", skinClasses("mutedInk"))}>{lines.join(" · ")}</p>
          )}
        </div>
      </div>

      {marks.length > 0 && (
        <ul aria-label={t("today.complete.outcomesAria")} className={ecn("flex flex-wrap items-center gap-1", indent)}>
          {marks.map((item) => {
            const outcome = outcomes?.[item.id] ?? outcomeOf(item);
            const MarkIcon = OUTCOME_ICON[outcome];
            return (
              <li
                key={item.id}
                className={ecn(
                  "flex size-5 items-center justify-center rounded-full",
                  outcomeClasses(outcome, "circle")
                )}
              >
                <MarkIcon aria-hidden weight="fill" className="size-3.5" />
                <span className="sr-only">{`${item.title}: ${t(`result.${outcome}`)}`}</span>
              </li>
            );
          })}
        </ul>
      )}

      {resume && (
        // The play heroes carry their own resume CTA.
        <div className={ecn("min-w-0 [.ui-cleaner-play_&]:hidden [.ui-play_&]:hidden", indent)}>
          <button
          type="button"
          onClick={() =>
            navigate({
              to: RESUME_ROUTE,
              search: resumeSearchParams(resume) as {
                courseId: string;
                levelId?: string;
                subjectId: string;
                moduleId: string;
                chapterId: string;
                slideId: string;
                sessionId: string;
              },
            })
          }
          className={ecn(
            "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md text-start text-body font-medium text-primary-500 hover:underline",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          )}
        >
          <Play aria-hidden weight="fill" className="size-4 shrink-0 rtl:-scale-x-100" />
          <span className="shrink-0">{t("today.complete.keepGoing")}</span>
          <bdi className="min-w-0 truncate">{resume.slideTitle || resume.courseName}</bdi>
        </button>
        </div>
      )}
    </div>
  );
}
