import { Fire, Play, VideoCamera } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ProgressRing } from "./ProgressRing";
import heroGreeting from "@/assets/cleaner-play/hero-greeting.webp";
import { SessionDetails } from "@/routes/study-library/live-class/-types/types";
import {
  streakCountdown,
  streakPrompt,
  useDashboardHeroData,
  type DailyTaskProgress,
} from "./useDashboardHeroData";

/**
 * CleanerPlayDashboardHero — the "Cleaner Play" skin's hero band.
 *
 * Same facts as PlayDashboardHero (via useDashboardHeroData); only the
 * visual language differs — warm white surface, felted-clay mascot, and a
 * brand-driven CTA (bg-primary) instead of the fixed play-success green,
 * per institute theming.
 */
export interface CleanerPlayDashboardHeroProps {
  userName: string | null;
  liveSessions: SessionDetails[] | undefined;
  isLoadingLive: boolean;
  hasAnyProgress: boolean;
  studyLibraryLoaded: boolean;
  onJoinSession: (session: SessionDetails) => void;
  /** The institute's gamification flag. Off hides the streak and the points goal. */
  showGamification?: boolean;
  /** Today's daily tasks while a plan runs; the goal ring then tracks them. */
  taskProgress?: DailyTaskProgress | null;
}

function HeroSkeleton(): JSX.Element {
  return (
    <div className="cp-card cp-hero-card rounded-2xl p-4 md:p-6">
      <div className="flex animate-pulse flex-col items-center gap-5 md:flex-row md:gap-8">
        <div className="flex items-center gap-4 self-start md:self-center">
          <div className="h-24 w-24 rounded-full bg-cp-bg-deep" />
          <div className="flex flex-col gap-2.5">
            <div className="h-7 w-44 rounded-full bg-cp-bg-deep" />
            <div className="flex gap-2">
              <div className="h-10 w-28 rounded-full bg-cp-bg-deep" />
              <div className="h-10 w-28 rounded-full bg-cp-bg-deep" />
            </div>
          </div>
        </div>
        <div className="h-20 w-full rounded-2xl bg-cp-bg-deep md:flex-1" />
      </div>
    </div>
  );
}

export function CleanerPlayDashboardHero(
  props: CleanerPlayDashboardHeroProps
): JSX.Element {
  const { t } = useTranslation("dashboard");
  const { t: tE } = useTranslation("dashboardEngagement");
  const {
    userName,
    liveSessions,
    isLoadingLive,
    hasAnyProgress,
    studyLibraryLoaded,
    onJoinSession,
    showGamification = true,
    taskProgress = null,
  } = props;

  const {
    greeting,
    streak,
    streakState,
    goalPercent,
    taskProgress: goalTasks,
    resume,
    imminent,
    liveClassTerm,
    isContinue,
    ctaCaption,
    goToCta,
  } = useDashboardHeroData({
    userName,
    liveSessions,
    hasAnyProgress,
    showGamification,
    taskProgress,
  });
  const prompt = showGamification && streakState.status === "atRisk"
    ? streakPrompt(streakState, tE)
    : null;
  const countdown = showGamification ? streakCountdown(streakState, tE) : null;
  // The goal ring is shown when it measures tasks (a plan runs) or, with
  // gamification on, today's points.
  const showGoal = Boolean(goalTasks) || showGamification;

  const ctaLabel = isContinue ? t("hero.ctaContinue") : t("hero.ctaStartLearning");

  if (!studyLibraryLoaded) {
    return <HeroSkeleton />;
  }

  return (
    <div className="flex flex-col gap-stack">
      {/* Live / imminent class banner */}
      {isLoadingLive ? (
        <div className="h-11 w-full max-w-md animate-pulse self-start rounded-full bg-cp-bg-deep" />
      ) : (
        imminent && (
          <div className="flex items-center gap-3 rounded-full bg-danger-50 py-2 ps-4 pe-2">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger-500/60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-danger-500" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-caption font-semibold uppercase tracking-wide text-danger-600">
                {imminent.isLive
                  ? t("hero.liveNow", { liveClass: liveClassTerm })
                  : t("hero.startsInMinutes", {
                      liveClass: liveClassTerm,
                      count: imminent.minutesToStart,
                    })}
              </p>
              <p className="cp-heading truncate text-body leading-tight">
                {imminent.session.title}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onJoinSession(imminent.session)}
              className={cn(
                "h-11 shrink-0 rounded-full bg-white px-5 text-body font-semibold text-danger-600",
                "shadow-sm active:translate-y-0.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-300"
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <VideoCamera weight="fill" size={18} />
                {t("hero.join")}
              </span>
            </button>
          </div>
        )
      )}

      {/* Hero band */}
      <div className="cp-card cp-hero-card rounded-2xl p-4 md:p-6">
        <div className="flex flex-col items-stretch gap-5 md:flex-row md:items-center md:gap-8">
          {/* Left: mascot + greeting + chips */}
          <div className="flex items-center gap-4">
            <img
              src={heroGreeting}
              alt=""
              aria-hidden="true"
              className="cp-hero-illustration h-24 w-auto shrink-0 sm:h-28"
            />
            <div className="min-w-0">
              <h1 className="cp-heading text-h2">{greeting}</h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {/* Streak flame chip: the server streak, with its kept /
                    at-risk / zero states (filled, outlined, muted flame). */}
                {showGamification && (
                  <span className="inline-flex h-11 items-center gap-1.5 rounded-full bg-cp-gold-tint px-3">
                    <Fire
                      weight={streakState.status === "kept" ? "fill" : "regular"}
                      size={20}
                      className={streak > 0 ? "text-cp-gold" : "text-cp-muted"}
                    />
                    {streakState.status === "zero" ? (
                      <span className="cp-heading text-caption">
                        {tE("streakStatus.start")}
                      </span>
                    ) : (
                      <>
                        <span className="cp-heading text-body tabular-nums">
                          {streak}
                        </span>
                        <span className="cp-muted text-caption font-medium">
                          {t("hero.dayStreakChip")}
                        </span>
                      </>
                    )}
                  </span>
                )}
                {/* Daily goal ring chip: today's tasks while a plan runs,
                    else today's points. */}
                {showGoal && (
                  <span className="inline-flex h-11 items-center gap-2 rounded-full bg-cp-surface px-3">
                    <ProgressRing
                      value={goalPercent}
                      size={28}
                      strokeWidth={4}
                      color="hsl(var(--primary-500))"
                      bgColor="hsl(var(--cp-sage) / 0.25)"
                      showLabel={false}
                    />
                    <span className="cp-muted text-caption font-medium tabular-nums">
                      {goalTasks
                        ? tE("heroGoal.tasks", {
                            done: goalTasks.done,
                            count: goalTasks.scheduled,
                          })
                        : t("hero.dailyGoal")}
                    </span>
                  </span>
                )}
              </div>
              {prompt && (
                <p className="cp-muted mt-2 text-caption font-medium">
                  {prompt}
                  {countdown && (
                    <span className="cp-heading"> · {countdown}</span>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Right: the one CTA — brand-driven, not a fixed skin color */}
          <div className="flex flex-1 justify-center md:justify-end">
            <button
              type="button"
              onClick={goToCta}
              aria-label={
                // ctaLabel is already "Continue" / "Start learning" here —
                // no " learning" suffix, unlike Play's "START"/"CONTINUE".
                resume
                  ? t("hero.continueAria", { title: resume.slideTitle })
                  : ctaLabel
              }
              className={cn(
                "w-full max-w-md rounded-full bg-primary px-8 py-4 text-primary-foreground",
                "shadow-sm transition-transform active:translate-y-0.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
              )}
            >
              <span className="flex items-center justify-center gap-3">
                <Play weight="fill" size={24} className="shrink-0" />
                <span className="flex min-w-0 flex-col items-start gap-1">
                  <span className="text-h3 font-bold leading-none">
                    {ctaLabel}
                  </span>
                  <span className="max-w-full truncate rounded-full bg-white/20 px-3 py-0.5 text-caption font-medium">
                    {ctaCaption}
                  </span>
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
