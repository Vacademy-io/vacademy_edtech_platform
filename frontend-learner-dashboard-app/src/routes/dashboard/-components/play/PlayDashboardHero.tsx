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

export interface PlayDashboardHeroProps {
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

/** Playful pulsing placeholder shown while the study library loads. */
function HeroSkeleton(): JSX.Element {
  return (
    <div className="rounded-play-card-sm border border-play-surface bg-play-highlight p-4 md:p-6">
      <div className="flex animate-pulse flex-col items-center gap-5 md:flex-row md:gap-8">
        <div className="flex items-center gap-4 self-start md:self-center">
          <div className="h-24 w-24 rounded-full bg-white/70" />
          <div className="flex flex-col gap-2.5">
            <div className="h-7 w-44 rounded-full bg-white/70" />
            <div className="flex gap-2">
              <div className="h-10 w-28 rounded-full bg-white/70" />
              <div className="h-10 w-28 rounded-full bg-white/70" />
            </div>
          </div>
        </div>
        <div className="h-20 w-full rounded-play-card-sm bg-white/70 md:flex-1" />
      </div>
    </div>
  );
}

export function PlayDashboardHero(props: PlayDashboardHeroProps): JSX.Element {
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

  const ctaLabel = isContinue ? t("hero.ctaContinueUpper") : t("hero.ctaStartUpper");

  if (!studyLibraryLoaded) {
    return <HeroSkeleton />;
  }

  return (
    <div className="flex flex-col gap-stack">
      {/* Live / imminent class banner */}
      {isLoadingLive ? (
        <div className="h-11 w-full max-w-md animate-pulse self-start rounded-full bg-play-surface" />
      ) : (
        imminent && (
          <div className="flex items-center gap-3 rounded-full bg-play-danger-soft py-2 ps-4 pe-2">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="play-pulse absolute inline-flex h-full w-full rounded-full bg-play-danger/50" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-play-danger" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-caption font-black uppercase tracking-wide text-play-danger-soft-ink">
                {imminent.isLive
                  ? t("hero.liveNow", { liveClass: liveClassTerm })
                  : t("hero.startsInMinutes", {
                      liveClass: liveClassTerm,
                      count: imminent.minutesToStart,
                    })}
              </p>
              <p className="truncate text-body font-bold leading-tight text-play-danger-soft-ink">
                {imminent.session.title}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onJoinSession(imminent.session)}
              className={cn(
                "h-11 shrink-0 rounded-full bg-white px-5 text-body font-black text-play-danger-soft-ink",
                "shadow-play-soft-card active:translate-y-0.5 active:shadow-none",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-play-danger-soft"
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <VideoCamera weight="fill" size={18} className="text-play-danger" />
                {t("hero.join")}
              </span>
            </button>
          </div>
        )
      )}

      {/* Hero band */}
      <div className="rounded-play-card-sm border border-play-surface bg-play-highlight p-4 md:p-6">
        <div className="flex flex-col items-stretch gap-5 md:flex-row md:items-center md:gap-8">
          {/* Left: mascot + greeting + chips */}
          <div className="flex items-center gap-4">
            <img
              src={heroGreeting}
              alt=""
              aria-hidden="true"
              className="play-float h-24 w-auto shrink-0 sm:h-28"
            />
            <div className="min-w-0">
              <h1 className="text-h2 font-bold text-play-ink">{greeting}!</h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {/* Streak flame chip: the server streak, with its kept /
                    at-risk / zero states (filled, outlined, muted flame). */}
                {showGamification && (
                  <span className="inline-flex h-11 items-center gap-1.5 rounded-full bg-white px-3 shadow-play-soft">
                    <Fire
                      weight={streakState.status === "kept" ? "fill" : "regular"}
                      size={20}
                      className={streak > 0 ? "text-play-warn" : "text-play-muted"}
                    />
                    {streakState.status === "zero" ? (
                      <span className="text-caption font-bold text-play-ink">
                        {tE("streakStatus.start")}
                      </span>
                    ) : (
                      <>
                        <span className="text-body font-black tabular-nums text-play-ink">
                          {streak}
                        </span>
                        <span className="text-caption font-bold text-play-ink">
                          {t("hero.dayStreakChip")}
                        </span>
                      </>
                    )}
                  </span>
                )}
                {/* Daily goal ring chip: today's tasks while a plan runs,
                    else today's points. */}
                {showGoal && (
                  <span className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-3 shadow-play-soft">
                    <ProgressRing
                      value={goalPercent}
                      size={30}
                      strokeWidth={5}
                      showLabel={false}
                    />
                    <span className="text-caption font-bold tabular-nums text-play-ink">
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
                <p className="mt-2 text-caption font-bold text-play-warn-soft-ink">
                  {prompt}
                  {countdown && (
                    <span className="font-black"> · {countdown}</span>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Right: the one giant START / CONTINUE node */}
          <div className="flex flex-1 justify-center md:justify-end">
            <button
              type="button"
              onClick={goToCta}
              aria-label={
                // Whole-sentence aria keys — never ctaLabel + " learning", so
                // translators aren't handed a fragment to glue.
                resume
                  ? t("hero.continueAria", { title: resume.slideTitle })
                  : isContinue
                    ? t("hero.ctaContinueLearningAria")
                    : t("hero.ctaStartLearningAria")
              }
              className={cn(
                "w-full max-w-md rounded-play-card bg-play-success px-8 py-4",
                "shadow-play-4d-success active:translate-y-0.5 active:shadow-none",
                "transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-play-ink/30"
              )}
            >
              <span className="flex items-center justify-center gap-3">
                <Play weight="fill" size={32} className="shrink-0 text-white" />
                <span className="flex min-w-0 flex-col items-start gap-1">
                  <span className="text-display-sm font-black leading-none text-white">
                    {ctaLabel}
                  </span>
                  <span className="max-w-full truncate rounded-full bg-white px-3 py-0.5 text-caption font-bold text-play-ink">
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
