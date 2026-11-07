import { DashbaordResponse, UserActivityArray } from "@/routes/dashboard/-types/dashboard-data-types";
import { WeeklyAttendanceData } from "@/services/attendance/getWeeklyAttendance";
import {
  BadgesRewardsConfig,
  BadgeDefinitionConfig,
  DEFAULT_BADGE_CONFIG,
  ScoringConfig,
  DEFAULT_SCORING,
  isManualTrigger,
} from "@/services/badge-config";
import type { AwardedBadge } from "@/services/awarded-badges";
import type { PointsStreakDay, PointsSummary } from "@/services/points";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

// ── Types ────────────────────────────────────────────────────────────

export interface PlayBadge {
  id: string;
  name: string;
  description: string;
  icon: string; // Phosphor icon name
  unlocked: boolean;
  unlockedAt: string | null; // ISO date
  /**
   * True when staff awarded this badge (award row with source MANUAL, or an award
   * row from an older server that has no source). A synced auto-unlock row
   * (source AUTO) does NOT set this — it just confirms the unlock.
   */
  isAdminAwarded?: boolean;
  /** The admin's reason/note for a manual award. */
  awardReason?: string | null;
  /** Unlock trigger + progress toward it (for the achievements popup). Absent on awarded-only badges. */
  trigger?: string;
  threshold?: number;
  progressCurrent?: number;
  /** Mirrors the config flag; hidden badges are only emitted once unlocked. */
  hidden?: boolean;
  /** Server award source ("MANUAL" | "AUTO") when an award row exists. */
  source?: string;
}

export interface PlayGamificationData {
  // Streak
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  weeklyDots: boolean[]; // Mon–Sun, true = active
  /**
   * Server streak state (points summary). Absent when the server sent none; the
   * streak above is then the browser's activity-log estimate.
   */
  keptToday?: boolean | null;
  last7Days?: PointsStreakDay[] | null;
  /** Where `currentStreak` came from. */
  streakSource?: "server" | "client";

  // XP
  totalXp: number;
  todayXp: number;
  level: number;
  xpToNextLevel: number; // remaining XP to level up

  // Achievements
  badges: PlayBadge[];
  /** Master toggle — false hides every badge surface. Optional/undefined = enabled (back-compat). */
  badgesEnabled?: boolean;
  /** How the total XP/points break down per factor (for the learner-facing explainer). */
  xpBreakdown?: XpBreakdownItem[];
}

/** One line of the points breakdown shown to the learner. */
export interface XpBreakdownItem {
  key: string;
  label: string;
  points: number;
}

// ── Constants ────────────────────────────────────────────────────────

const XP_PER_LEVEL = 500;

// ── Cache ────────────────────────────────────────────────────────────

const CACHE_PREFIX = "PLAY_GAMIFICATION_V1";

function getCacheKey(instituteId: string) {
  return `${CACHE_PREFIX}:${instituteId}`;
}

export function getCachedGamification(
  instituteId: string
): PlayGamificationData | null {
  try {
    const raw = localStorage.getItem(getCacheKey(instituteId));
    if (!raw) return null;
    return JSON.parse(raw) as PlayGamificationData;
  } catch {
    return null;
  }
}

/**
 * Write the display cache that off-dashboard surfaces read on a fresh load. Call it
 * only with FINAL figures (after the server points overlay) — writing the browser-
 * computed numbers here is what made the pill disagree with the dashboard.
 */
export function setCachedGamification(
  instituteId: string,
  data: PlayGamificationData
) {
  try {
    localStorage.setItem(getCacheKey(instituteId), JSON.stringify(data));
  } catch {
    // storage full — ignore
  }
}

// ── Computation ──────────────────────────────────────────────────────

/**
 * Compute streak from activity data (must be sorted by date ascending).
 * A day is "active" if time_spent_by_user_millis > 0.
 */
function computeStreak(activities: UserActivityArray): {
  current: number;
  longest: number;
  lastActive: string | null;
} {
  if (!activities.length) return { current: 0, longest: 0, lastActive: null };

  // Build a Set of active dates (yyyy-MM-dd)
  const activeDates = new Set<string>();
  for (const a of activities) {
    if (a.time_spent_by_user_millis > 0) {
      activeDates.add(a.activity_date.slice(0, 10));
    }
  }

  if (activeDates.size === 0) return { current: 0, longest: 0, lastActive: null };

  const sortedDates = [...activeDates].sort();
  const lastActive = sortedDates[sortedDates.length - 1]!;

  // Walk backwards from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let current = 0;
  const d = new Date(today);
  // Allow today or yesterday as the start
  const todayStr = d.toISOString().slice(0, 10);
  if (!activeDates.has(todayStr)) {
    d.setDate(d.getDate() - 1);
  }

  while (activeDates.has(d.toISOString().slice(0, 10))) {
    current++;
    d.setDate(d.getDate() - 1);
  }

  // Longest streak
  let longest = 0;
  let streak = 0;
  let prev: Date | null = null;
  for (const dateStr of sortedDates) {
    const curr = new Date(dateStr);
    if (prev) {
      const diffDays = Math.round(
        (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diffDays === 1) {
        streak++;
      } else {
        streak = 1;
      }
    } else {
      streak = 1;
    }
    longest = Math.max(longest, streak);
    prev = curr;
  }

  return { current, longest, lastActive };
}

/** Inputs the configurable points formula is evaluated against (learner's own data). */
interface XpContext {
  activeDays: number;
  streak: number;
  attendedClasses: number;
  completionPct: number; // 0–100, best course
  assessmentPct: number; // 0–100, best assessment
}

/**
 * Compute total points + a per-factor breakdown using the institute's
 * admin-configured "points per action" scoring.
 */
function computeXp(
  scoring: ScoringConfig,
  ctx: XpContext
): { total: number; breakdown: XpBreakdownItem[] } {
  const items: XpBreakdownItem[] = [
    {
      key: "activity",
      label: "Learning activity",
      points: Math.round(scoring.activityPerDay * ctx.activeDays),
    },
    {
      key: "streak",
      label: "Daily streak",
      points: Math.round(scoring.streakPerDay * ctx.streak),
    },
    {
      key: "live",
      label: "Live classes",
      points: Math.round(scoring.liveClassAttended * ctx.attendedClasses),
    },
    {
      key: "completion",
      label: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} completion`,
      points: Math.round(scoring.courseCompletion * (ctx.completionPct / 100)),
    },
    {
      key: "assessment",
      label: "Assessment score",
      points: Math.round(scoring.assessmentBestScore * (ctx.assessmentPct / 100)),
    },
  ];
  // Only surface factors the institute actually rewards (point weight > 0).
  const breakdown = items.filter((_, idx) => {
    const weights = [
      scoring.activityPerDay,
      scoring.streakPerDay,
      scoring.liveClassAttended,
      scoring.courseCompletion,
      scoring.assessmentBestScore,
    ];
    return weights[idx] > 0;
  });
  const total = breakdown.reduce((sum, i) => sum + i.points, 0);
  return { total, breakdown };
}

/**
 * Compute weekly activity dots from attendance data.
 */
function computeWeeklyDots(
  attendance: WeeklyAttendanceData | null
): boolean[] {
  if (!attendance?.days) return Array(7).fill(false);
  return attendance.days.map(
    (day) => day.status === "PRESENT"
  );
}

/** Inputs an admin-configured badge trigger is evaluated against. */
export interface BadgeEvalContext {
  courses: number;
  slides: number;
  streak: number;
  totalXp: number;
  /** Highest course completion % across the learner's courses (0–100). */
  maxCourseCompletionPct: number;
  /** Highest assessment score % across released attempts, or null if unknown. */
  bestAssessmentScorePct: number | null;
  /** Total live classes attended (lookback window). */
  liveSessionCount: number;
  /** Live classes attended in a row, newest-first (no misses). */
  liveSessionStreak: number;
}

/** The learner's current value for a badge's trigger — drives the progress bar in the popup. */
function badgeProgressCurrent(trigger: string, ctx: BadgeEvalContext): number {
  switch (trigger) {
    case "course_count":
      return ctx.courses;
    case "slide_count":
      return ctx.slides;
    case "streak":
      return ctx.streak;
    case "xp_total":
      return ctx.totalXp;
    case "course_completion":
      return ctx.maxCourseCompletionPct;
    case "assessment_score":
      return ctx.bestAssessmentScorePct ?? 0;
    case "live_session_count":
      return ctx.liveSessionCount;
    case "live_session_streak":
      return ctx.liveSessionStreak;
    case "manual":
      // Staff-awarded: there is no automatic condition to make progress on.
      return 0;
    default:
      return 0;
  }
}

/** Evaluate a single badge definition against the learner's stats. */
function isBadgeUnlocked(badge: BadgeDefinitionConfig, ctx: BadgeEvalContext): boolean {
  const t = badge.threshold;
  switch (badge.trigger) {
    case "course_count":
      return ctx.courses >= t;
    case "slide_count":
      return ctx.slides >= t;
    case "streak":
      return ctx.streak >= t;
    case "xp_total":
      return ctx.totalXp >= t;
    case "course_completion":
      return ctx.maxCourseCompletionPct >= t;
    case "assessment_score":
      return ctx.bestAssessmentScorePct != null && ctx.bestAssessmentScorePct >= t;
    case "live_session_count":
      return ctx.liveSessionCount >= t;
    case "live_session_streak":
      return ctx.liveSessionStreak >= t;
    case "manual":
      // Never auto-unlocks — only a staff award (merged in computeBadges) can.
      return false;
    default:
      return false;
  }
}

/**
 * True when an award row represents a staff award (vs. a synced auto-unlock).
 * Older servers omit `source`; those rows were always manual, so missing ⇒ MANUAL.
 */
function isStaffAward(award: AwardedBadge | undefined): boolean {
  if (!award) return false;
  return (award.source ?? "MANUAL").toUpperCase() !== "AUTO";
}

/**
 * Check which configured badges are unlocked. Driven by the per-institute admin
 * config (falls back to the default six). Server award rows are merged in: any
 * award row forces the badge unlocked (even if its trigger isn't met), but only
 * a MANUAL row marks it "awarded by staff"; a `manual` trigger never unlocks on
 * its own. Badges flagged `hidden` are left out entirely until earned so every
 * surface (and every "x/total" count) stays consistent. Awards for badges no
 * longer in the config are appended from their snapshot.
 */
export function computeBadges(
  config: BadgesRewardsConfig,
  ctx: BadgeEvalContext,
  awarded: AwardedBadge[]
): PlayBadge[] {
  const now = new Date().toISOString();
  const awardByBadgeId = new Map<string, AwardedBadge>();
  for (const a of awarded) {
    if (a?.badgeId) awardByBadgeId.set(a.badgeId, a);
  }

  const badges: PlayBadge[] = [];
  for (const def of config.badges) {
    const award = awardByBadgeId.get(def.id);
    const autoUnlocked = isManualTrigger(def.trigger) ? false : isBadgeUnlocked(def, ctx);
    const unlocked = autoUnlocked || Boolean(award);
    // Hidden ("mystery") badges stay invisible until earned.
    if (def.hidden === true && !unlocked) continue;
    const isAdminAwarded = isStaffAward(award);
    badges.push({
      id: def.id,
      name: def.name,
      description: def.description,
      icon: def.icon,
      unlocked,
      unlockedAt: award?.awardedAt ?? (unlocked ? now : null),
      isAdminAwarded,
      awardReason: isAdminAwarded ? award?.reason ?? null : null,
      trigger: def.trigger,
      threshold: def.threshold,
      progressCurrent: isManualTrigger(def.trigger) ? 0 : badgeProgressCurrent(def.trigger, ctx),
      hidden: def.hidden === true,
      ...(award?.source ? { source: award.source } : {}),
    });
  }

  // Awarded badges that are no longer in the config (e.g. badge later removed)
  // still belong on the wall — render them from the award's snapshot. Track
  // emitted ids (seeded from config) so a duplicate award row can't double-render.
  const seenIds = new Set(config.badges.map((b) => b.id));
  for (const a of awarded) {
    if (!a?.badgeId || seenIds.has(a.badgeId)) continue;
    seenIds.add(a.badgeId);
    const isAdminAwarded = isStaffAward(a);
    badges.push({
      id: a.badgeId,
      name: a.badgeName || "Badge",
      description: a.badgeDescription || "",
      icon: a.badgeIcon || "Trophy",
      unlocked: true,
      unlockedAt: a.awardedAt ?? now,
      isAdminAwarded,
      awardReason: isAdminAwarded ? a.reason ?? null : null,
      ...(a.source ? { source: a.source } : {}),
    });
  }

  return badges;
}

// ── Celebration helpers ──────────────────────────────────────────────

/**
 * Badges unlocked in `next` that were not in the previous baseline. `null` baseline = no
 * previous complete run (first load) → nothing to celebrate. Disabled feature → nothing.
 */
export function findNewlyUnlockedSince(
  baseline: ReadonlySet<string> | null,
  next: PlayGamificationData
): PlayBadge[] {
  if (!baseline || next.badgesEnabled !== true) return [];
  return next.badges.filter((b) => b.unlocked && !baseline.has(b.id));
}

/** The unlocked badge ids of a snapshot, or null when there is no snapshot. */
export function unlockedBadgeIds(data: PlayGamificationData | null): Set<string> | null {
  if (!data) return null;
  return new Set((data.badges ?? []).filter((b) => b.unlocked).map((b) => b.id));
}

/** Convenience over {@link findNewlyUnlockedSince} for two full snapshots. */
export function findNewlyUnlockedBadges(
  prev: PlayGamificationData | null,
  next: PlayGamificationData
): PlayBadge[] {
  return findNewlyUnlockedSince(unlockedBadgeIds(prev), next);
}

/**
 * Celebration baseline — the unlocked ids as of the last COMPLETE computation (every
 * input query settled). Kept SEPARATE from the display cache above on purpose: the
 * dashboard recomputes on every input arrival and the cache is overwritten each time, so
 * an early run without the course tree (completion = 0, fewer XP) would otherwise become
 * the "previous visit" and re-celebrate completion/XP badges on every fresh session.
 * Scoped per institute AND learner so a shared device does not celebrate another
 * learner's badges.
 */
const BASELINE_PREFIX = "PLAY_BADGE_BASELINE_V1";

function baselineKey(instituteId: string, userId: string | null | undefined) {
  return `${BASELINE_PREFIX}:${instituteId}:${userId || "anon"}`;
}

export function readCelebrationBaseline(
  instituteId: string,
  userId: string | null | undefined
): Set<string> | null {
  try {
    const raw = localStorage.getItem(baselineKey(instituteId, userId));
    if (!raw) return null;
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.filter((x) => typeof x === "string")) : null;
  } catch {
    return null;
  }
}

export function writeCelebrationBaseline(
  instituteId: string,
  userId: string | null | undefined,
  data: PlayGamificationData
): void {
  try {
    const ids = [...(unlockedBadgeIds(data) ?? [])];
    localStorage.setItem(baselineKey(instituteId, userId), JSON.stringify(ids));
  } catch {
    // storage full / unavailable — celebrate conservatively next time (no baseline = quiet)
  }
}

const CELEBRATED_BADGES_KEY = "vacademy.celebratedBadges.v1";

/**
 * Once-per-badge guard for the unlock celebration (sessionStorage; per-tab is
 * fine for a celebratory moment). Returns true the first time a badge id is seen.
 */
export function shouldCelebrateBadge(badgeId: string): boolean {
  if (!badgeId) return false;
  try {
    const seen: string[] = JSON.parse(sessionStorage.getItem(CELEBRATED_BADGES_KEY) ?? "[]");
    if (seen.includes(badgeId)) return false;
    sessionStorage.setItem(
      CELEBRATED_BADGES_KEY,
      JSON.stringify([...seen.slice(-99), badgeId])
    );
    return true;
  } catch {
    return true;
  }
}

// ── Main Entry Point ─────────────────────────────────────────────────

export function computeGamificationData(params: {
  dashboard: DashbaordResponse | null;
  activities: UserActivityArray;
  attendance: WeeklyAttendanceData | null;
  instituteId: string;
  /** Per-institute badge config; defaults to the original six when omitted. */
  badgeConfig?: BadgesRewardsConfig | null;
  /** Learner's courses with completion %, used for the course_completion trigger. */
  studyLibrary?: Array<{ percentage_completed?: number | null }> | null;
  /** Best assessment score %, used for the assessment_score trigger. */
  bestAssessmentScorePct?: number | null;
  /** Admin-awarded badges (server-persisted) merged over the computed unlocks. */
  awardedBadges?: AwardedBadge[];
  /** Admin-configured points-per-action scoring; defaults applied when omitted. */
  scoring?: ScoringConfig | null;
  /** Total live classes attended (lookback window), for live_session_count. */
  liveSessionCount?: number;
  /** Live classes attended in a row (no misses), for live_session_streak. */
  liveSessionStreak?: number;
  /**
   * The server streak (points summary). When given it replaces the browser's
   * activity-log streak everywhere: the display, the streak points line (0 when the
   * streak is 0) and the streak badge trigger, so every surface shows one number.
   */
  serverStreak?: { currentStreak: number; longestStreak?: number | null } | null;
}): PlayGamificationData {
  const {
    dashboard,
    activities,
    attendance,
    badgeConfig,
    studyLibrary,
    bestAssessmentScorePct = null,
    awardedBadges = [],
    scoring,
    liveSessionCount = 0,
    liveSessionStreak = 0,
    serverStreak = null,
  } = params;

  const clientStreak = computeStreak(activities);
  const lastActive = clientStreak.lastActive;
  const useServerStreak =
    serverStreak != null && Number.isFinite(serverStreak.currentStreak);
  const currentStreak = useServerStreak
    ? Math.max(0, serverStreak.currentStreak)
    : clientStreak.current;
  const longestStreak = useServerStreak
    ? Math.max(currentStreak, serverStreak.longestStreak ?? 0)
    : clientStreak.longest;

  const attendanceDays = attendance?.days
    ? attendance.days.filter((d) => d.status === "PRESENT").length
    : 0;

  // Distinct days the learner was active (drives the activity points factor).
  const activeDays = new Set(
    activities
      .filter((a) => a.time_spent_by_user_millis > 0)
      .map((a) => a.activity_date.slice(0, 10))
  ).size;

  const maxCourseCompletionPct = (studyLibrary ?? []).reduce(
    (max, c) => Math.max(max, c?.percentage_completed ?? 0),
    0
  );

  const { total: totalXp, breakdown: xpBreakdown } = computeXp(
    scoring ?? DEFAULT_SCORING,
    {
      activeDays,
      streak: currentStreak,
      attendedClasses: attendanceDays,
      completionPct: maxCourseCompletionPct,
      assessmentPct: bestAssessmentScorePct ?? 0,
    }
  );
  const todayXp = 0;

  const level = Math.floor(totalXp / XP_PER_LEVEL) + 1;
  const xpInCurrentLevel = totalXp % XP_PER_LEVEL;
  const xpToNextLevel = XP_PER_LEVEL - xpInCurrentLevel;

  const weeklyDots = computeWeeklyDots(attendance);

  // Master toggle: when the institute disabled the feature, emit no badges at all.
  const cfg = badgeConfig ?? DEFAULT_BADGE_CONFIG;
  const badgesEnabled = cfg.enabled === true;
  const badges = badgesEnabled
    ? computeBadges(
        cfg,
        {
          courses: dashboard?.courses ?? 0,
          slides: dashboard?.slides?.length ?? 0,
          streak: currentStreak,
          totalXp,
          maxCourseCompletionPct,
          bestAssessmentScorePct,
          liveSessionCount,
          liveSessionStreak,
        },
        awardedBadges
      )
    : [];

  const data: PlayGamificationData = {
    currentStreak,
    longestStreak,
    lastActivityDate: lastActive,
    weeklyDots,
    totalXp,
    todayXp,
    level,
    xpToNextLevel,
    badges,
    badgesEnabled,
    xpBreakdown,
    streakSource: useServerStreak ? "server" : "client",
  };

  // The display cache is NOT written here (D2): the caller overlays the server
  // points first and then calls setCachedGamification with the final figures.
  // `instituteId` stays in the params so existing callers keep compiling.

  return data;
}

/**
 * Overlay the authoritative server figures on a computed snapshot: totals, level,
 * breakdown, and the streak when the server sends one. Returns a new object; `null`
 * summary returns the input unchanged.
 */
export function applyServerPoints(
  data: PlayGamificationData,
  summary: PointsSummary | null | undefined
): PlayGamificationData {
  if (!summary) return data;
  const next: PlayGamificationData = {
    ...data,
    totalXp: summary.totalPoints,
    todayXp: summary.todayPoints,
    level: summary.level,
    xpToNextLevel: summary.pointsToNextLevel,
  };
  if (summary.breakdown?.length) {
    next.xpBreakdown = summary.breakdown.map((b) => ({
      key: b.key,
      label: b.label,
      points: b.points,
    }));
  }
  if (typeof summary.currentStreak === "number") {
    next.currentStreak = Math.max(0, summary.currentStreak);
    next.longestStreak = Math.max(next.currentStreak, summary.longestStreak ?? 0);
    next.keptToday = summary.keptToday ?? null;
    next.last7Days = summary.last7Days ?? null;
    next.streakSource = "server";
  }
  return next;
}
