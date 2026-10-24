import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useNavigate } from "@tanstack/react-router";
import { usePlayGamificationStore } from "@/stores/play-gamification-store";
import {
  usePointsSummary,
  useCurrentInstituteId,
  type PointsStreakDay,
} from "@/services/points";
import { formatDate } from "@/lib/formatters";
import {
  getLatestResume,
  resumeSearchParams,
  RESUME_ROUTE,
  type ResumeEntry,
} from "@/services/resume-thread";
import { SessionDetails } from "@/routes/study-library/live-class/-types/types";
import {
  isSessionLiveTimezoneAware,
  convertSessionTimeToUserTimezone,
} from "@/utils/timezone";
import {
  getTerminology,
  readEngagementPlanFlag,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

/**
 * Shared data/derivation layer for the Play and Cleaner Play dashboard
 * heroes. Both skins render the same facts (greeting, streak, daily-goal
 * ring, resume thread, imminent live session, CTA target) with different
 * visual language — this hook is the single source of those facts so the
 * two hero files can't drift apart again (they had already diverged once:
 * reduced-motion guards and a doubled aria-label suffix).
 */

// ── Streak: one value everywhere (D9, D42) ──────────────────────────────────

/**
 * kept: today already counts. atRisk: a live streak that today has not yet
 * extended. zero: no streak.
 */
export type StreakStatus = "kept" | "atRisk" | "zero";

/** One dot of the seven-day strip. */
export interface StreakDayView {
  key: string;
  /** Narrow weekday in the active locale ("M", "T", ...). */
  label: string;
  /** Unambiguous name for screen readers ("Tuesday, 22 Sep"); two days share "T". */
  fullLabel: string;
  active: boolean;
  isToday: boolean;
}

export interface StreakState {
  current: number;
  longest: number;
  /** null when the source cannot say (the browser estimate). */
  keptToday: boolean | null;
  status: StreakStatus;
  /** Seven days, oldest first, today last. */
  days: StreakDayView[];
  /** Minutes left in the learner's (institute-local) day. */
  minutesLeft: number;
  /** Whether the learner's institute runs a daily-task plan (remembered flag). */
  hasPlan: boolean;
  source: "server" | "client";
  isLoading: boolean;
}

/** An at-risk streak shows a countdown once less than this much of the day is left. */
export const STREAK_COUNTDOWN_MINUTES = 4 * 60;

/** Pure: the display state for a streak value. */
export function streakStatusOf(current: number, keptToday: boolean | null | undefined): StreakStatus {
  if (!Number.isFinite(current) || current <= 0) return "zero";
  return keptToday === false ? "atRisk" : "kept";
}

/**
 * Pure: minutes until midnight in `timeZone` (the institute's, from the points
 * summary), else in the device's zone. Never negative.
 */
export function minutesLeftInDay(timeZone?: string | null, now: number = Date.now()): number {
  let hour: number | null = null;
  let minute: number | null = null;
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23",
      }).formatToParts(new Date(now));
      hour = Number(parts.find((p) => p.type === "hour")?.value);
      minute = Number(parts.find((p) => p.type === "minute")?.value);
    } catch {
      hour = null;
    }
  }
  if (hour === null || minute === null || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    const d = new Date(now);
    hour = d.getHours();
    minute = d.getMinutes();
  }
  return Math.max(0, 24 * 60 - ((hour % 24) * 60 + minute));
}

/** Pure: the server's seven days as dots, labelled with the date's own weekday. */
export function serverStreakDays(days: PointsStreakDay[]): StreakDayView[] {
  return days.slice(-7).map((day, i, all) => {
    const noon = day.date ? `${day.date}T12:00:00Z` : null;
    return {
      key: day.date ?? `d${i}`,
      label: noon
        ? formatDate(noon, {
            weekday: "narrow",
            day: undefined,
            month: undefined,
            year: undefined,
            timeZone: "UTC",
          })
        : "",
      fullLabel: noon
        ? formatDate(noon, { weekday: "long", year: undefined, timeZone: "UTC" })
        : "",
      active: day.active,
      isToday: i === all.length - 1,
    };
  });
}

/**
 * The learner's streak, read the same way by every surface that shows one:
 * the play and cleanerPlay heroes, StreakCounterWidget, the gamification panel,
 * AchievementsDialog (and the Today header in the other skins).
 *
 * Source: the server points summary (`['points','me']`), which every submit
 * patches and invalidates, so the value moves the moment a task is done. Only
 * when the server sends no streak (older server, or it failed) does it fall
 * back to the browser estimate in the gamification store.
 */
export function useStreakState(opts: { enabled?: boolean } = {}): StreakState {
  const { t } = useTranslation("dashboard");
  const enabled = opts.enabled ?? true;
  const { data: summary, isLoading: summaryLoading } = usePointsSummary({ enabled });
  const instituteId = useCurrentInstituteId();
  const storeData = usePlayGamificationStore((s) => s.data);
  const storeLoading = usePlayGamificationStore((s) => s.isLoading);
  const timeZone = (summary as unknown as { timezone?: unknown } | null | undefined)?.timezone;
  const zone = typeof timeZone === "string" ? timeZone : null;

  const serverStreak =
    typeof summary?.currentStreak === "number" && Number.isFinite(summary.currentStreak)
      ? summary.currentStreak
      : null;
  const current = Math.max(0, serverStreak ?? storeData?.currentStreak ?? 0);
  const keptToday =
    serverStreak !== null ? summary?.keptToday ?? null : storeData?.keptToday ?? null;
  const status = streakStatusOf(current, keptToday);

  // Tick once a minute only while the countdown can matter.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "atRisk") return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [status]);

  const days = useMemo<StreakDayView[]>(() => {
    const serverDays = serverStreak !== null ? summary?.last7Days : null;
    if (serverDays && serverDays.length > 0) return serverStreakDays(serverDays);
    const labels = [
      t("streak.dayInitial.monday"),
      t("streak.dayInitial.tuesday"),
      t("streak.dayInitial.wednesday"),
      t("streak.dayInitial.thursday"),
      t("streak.dayInitial.friday"),
      t("streak.dayInitial.saturday"),
      t("streak.dayInitial.sunday"),
    ];
    const dots = storeData?.weeklyDots ?? [];
    const today = new Date();
    const todayIndex = (today.getDay() + 6) % 7; // Monday-first
    return labels.map((label, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - todayIndex + i);
      return {
        key: `w${i}`,
        label,
        fullLabel: formatDate(date, { weekday: "long", year: undefined }),
        active: dots[i] === true,
        isToday: i === todayIndex,
      };
    });
  }, [serverStreak, summary?.last7Days, storeData?.weeklyDots, t]);

  return {
    current,
    longest: Math.max(current, summary?.longestStreak ?? storeData?.longestStreak ?? 0),
    keptToday,
    status,
    days,
    minutesLeft: minutesLeftInDay(zone, now),
    // This institute's plan, not any institute's (a learner in two institutes).
    hasPlan: readEngagementPlanFlag(instituteId),
    source: serverStreak !== null ? "server" : "client",
    isLoading: serverStreak === null && (summaryLoading || storeLoading),
  };
}

/** A `t` bound to the `dashboardEngagement` namespace. */
type EngagementT = TFunction;

/**
 * The one-line streak prompt (D42), or null when the streak is kept:
 * zero → "Start a streak today"; at risk → "Do 1 task to keep your 5-day
 * streak" (or "Learn today…" when no daily-task plan runs).
 */
export function streakPrompt(state: StreakState, t: EngagementT): string | null {
  if (state.status === "zero") return t("streakStatus.start");
  if (state.status === "atRisk") {
    return state.hasPlan
      ? t("streakStatus.atRiskTask", { count: state.current })
      : t("streakStatus.atRiskLearn", { count: state.current });
  }
  return null;
}

/** "Ends in 3h 20m" while an at-risk streak has under four hours left, else null. */
export function streakCountdown(state: StreakState, t: EngagementT): string | null {
  if (state.status !== "atRisk" || state.minutesLeft >= STREAK_COUNTDOWN_MINUTES) return null;
  const hours = Math.floor(state.minutesLeft / 60);
  const minutes = state.minutesLeft % 60;
  const time =
    hours > 0
      ? t("streakStatus.hoursMinutes", { hours, minutes })
      : t("streakStatus.minutes", { count: Math.max(1, minutes) });
  return t("streakStatus.endsIn", { time });
}

/** Today's daily-task progress, passed in by the dashboard while a plan runs. */
export interface DailyTaskProgress {
  done: number;
  scheduled: number;
}

/** XP a learner should earn in a day to fill the daily-goal ring. */
const DAILY_GOAL_XP = 50;
/** A session counts as "imminent" when it starts within this many minutes. */
const IMMINENT_WINDOW_MIN = 60;

export interface ImminentSession {
  session: SessionDetails;
  isLive: boolean;
  minutesToStart: number;
}

type GreetingPeriod = "morning" | "afternoon" | "evening";

function getGreetingPeriod(): GreetingPeriod {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** First live session, else the first one starting within the window. */
function findImminentSession(
  sessions: SessionDetails[] | undefined
): ImminentSession | null {
  if (!sessions || sessions.length === 0) return null;

  const live = sessions.find((s) => isSessionLiveTimezoneAware(s));
  if (live) return { session: live, isLive: true, minutesToStart: 0 };

  const now = Date.now();
  let best: ImminentSession | null = null;
  for (const s of sessions) {
    const start = convertSessionTimeToUserTimezone(
      s.meeting_date,
      s.start_time,
      s.timezone
    );
    if (Number.isNaN(start.getTime())) continue;
    const minutes = Math.ceil((start.getTime() - now) / 60000);
    if (minutes < 0 || minutes > IMMINENT_WINDOW_MIN) continue;
    if (!best || minutes < best.minutesToStart) {
      best = { session: s, isLive: false, minutesToStart: minutes };
    }
  }
  return best;
}

export interface DashboardHeroData {
  /** "Good morning, Priya" — no trailing punctuation; skins add their own. */
  greeting: string;
  /** The one streak value (server first); see useStreakState. */
  streak: number;
  streakState: StreakState;
  goalPercent: number;
  /** Set while a daily-task plan runs: the ring is tasks done / scheduled. */
  taskProgress: DailyTaskProgress | null;
  resume: ResumeEntry | null;
  imminent: ImminentSession | null;
  liveClassTerm: string;
  /** Whether the CTA should read as "continue" (vs "start fresh"). */
  isContinue: boolean;
  /** Sub-caption under the CTA label (resume title / generic nudge). */
  ctaCaption: string;
  goToCta: () => void;
}

export function useDashboardHeroData({
  userName,
  liveSessions,
  hasAnyProgress,
  showGamification = true,
  taskProgress = null,
}: {
  userName: string | null;
  liveSessions: SessionDetails[] | undefined;
  hasAnyProgress: boolean;
  /** The institute's gamification flag; off = no streak and no points read. */
  showGamification?: boolean;
  taskProgress?: DailyTaskProgress | null;
}): DashboardHeroData {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const gamification = usePlayGamificationStore((s) => s.data);
  const streakState = useStreakState({ enabled: showGamification });
  const { data: serverPoints } = usePointsSummary({ enabled: showGamification });

  const resume = useMemo(() => getLatestResume(), []);
  const imminent = useMemo(
    () => findImminentSession(liveSessions),
    [liveSessions]
  );

  const liveClassTerm = getTerminology(
    ContentTerms.LiveSession,
    SystemTerms.LiveSession
  );
  const slideTerm = getTerminology(
    ContentTerms.Slides,
    SystemTerms.Slides
  ).toLocaleLowerCase();

  // Whole-sentence greeting keys per time-of-day — never "Good " + period, so
  // translators control word order and the period noun's case/agreement.
  const period = getGreetingPeriod();
  const firstName = userName?.trim().split(/\s+/)[0] ?? "";
  const greeting = firstName
    ? t(`hero.greeting.${period}WithName`, { name: firstName })
    : t(`hero.greeting.${period}`);

  const streak = streakState.current;
  // Daily goal: while a plan runs, today's tasks done / scheduled (so the ring
  // moves with every task); otherwise today's points against DAILY_GOAL_XP,
  // full once today already counts toward the streak.
  const activeTaskProgress =
    taskProgress && taskProgress.scheduled > 0 ? taskProgress : null;
  const todayXp = serverPoints?.todayPoints ?? gamification?.todayXp ?? 0;
  const todayActive =
    streakState.keptToday ?? streakState.days.find((d) => d.isToday)?.active ?? false;
  const goalPercent = activeTaskProgress
    ? Math.min(
        100,
        Math.round((Math.max(0, activeTaskProgress.done) / activeTaskProgress.scheduled) * 100)
      )
    : Math.max(
        todayActive ? 100 : 0,
        Math.min(100, Math.round((todayXp / DAILY_GOAL_XP) * 100))
      );

  const isContinue = resume !== null || hasAnyProgress;
  const ctaCaption = resume
    ? resume.slideTitle
    : isContinue
      ? t("hero.pickUpWhereLeftOff")
      : t("hero.yourFirstSlide", { slide: slideTerm });

  // Existing app pattern: loosely-typed navigate (the resume route's search
  // schema is validated by the destination route itself).
  const goToCta = () => {
    if (resume) {
      const to: string = RESUME_ROUTE;
      navigate({ to, search: resumeSearchParams(resume) });
    } else {
      navigate({ to: "/study-library/courses" });
    }
  };

  return {
    greeting,
    streak,
    streakState,
    goalPercent,
    taskProgress: activeTaskProgress,
    resume,
    imminent,
    liveClassTerm,
    isContinue,
    ctaCaption,
    goToCta,
  };
}
