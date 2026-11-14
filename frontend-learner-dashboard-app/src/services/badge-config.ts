import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";
import { instituteSettingsCache } from "@/services/institute-settings-cache";

/**
 * Admin-configurable badge system (learner side).
 *
 * Badge DEFINITIONS are authored per-institute in the admin dashboard
 * (Settings → "Badges & Rewards") and persisted under the institute setting key
 * {@link BADGES_REWARDS_SETTING_KEY}. The learner dashboard reads that config
 * and evaluates unlock state entirely on the client (see play-gamification.ts).
 *
 * Keep this schema in lock-step with the admin copy at
 * `frontend-admin-dashboard/src/routes/settings/-constants/badge-config.ts`.
 */

export const BADGES_REWARDS_SETTING_KEY = "BADGES_REWARDS_SETTING";

/** How a badge decides whether it's unlocked. */
export type BadgeTriggerType =
  | "manual" // never auto-unlocks; only via a staff award (learner_badge row, source MANUAL)
  | "course_count" // enrolled/assigned courses >= threshold
  | "slide_count" // slides available >= threshold
  | "streak" // current daily streak (days) >= threshold
  | "xp_total" // total XP >= threshold
  | "course_completion" // any course completion % >= threshold
  | "assessment_score" // best assessment score % >= threshold
  | "live_session_count" // total live classes attended >= threshold
  | "live_session_streak"; // live classes attended in a row (no misses) >= threshold

export interface BadgeDefinitionConfig {
  id: string;
  name: string;
  description: string;
  icon: string; // one of BADGE_ICON_NAMES, a `lib:` library token, or an uploaded file id
  trigger: BadgeTriggerType;
  /** Unlock threshold for auto triggers; always 0 for `manual`. */
  threshold: number;
  enabled: boolean;
  /**
   * Hidden from the learner until earned (a "mystery" badge). Optional for
   * back-compat; absent = visible. Named `hidden` (not `secret`) to match the admin copy.
   */
  hidden?: boolean;
}

/** True for the staff-awarded trigger — the badge has no automatic unlock condition. */
export function isManualTrigger(trigger: string | undefined | null): boolean {
  return trigger === "manual";
}

/**
 * Admin-configurable "points per action" scoring. Drives the learner's XP/level
 * and (server-side) the leaderboard ranking. Each value is how many points a
 * single unit of that factor is worth.
 */
export interface ScoringConfig {
  /** Points per active learning day. */
  activityPerDay: number;
  /** Points per day of the current learning streak. */
  streakPerDay: number;
  /** Points per live class attended. */
  liveClassAttended: number;
  /** Points for finishing a course (scaled by completion %). */
  courseCompletion: number;
  /** Points for assessments (scaled by best score %). */
  assessmentBestScore: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  activityPerDay: 10,
  streakPerDay: 5,
  liveClassAttended: 20,
  courseCompletion: 100,
  assessmentBestScore: 50,
};

export interface BadgesRewardsConfig {
  version: number;
  /** Master switch for the whole badges + leaderboard feature. When false, no
   *  badge/leaderboard surface renders anywhere. Defaults to OFF — opt-in per institute. */
  enabled: boolean;
  /** Points-per-action scoring (defaults applied when absent). */
  scoring?: ScoringConfig;
  badges: BadgeDefinitionConfig[];
}

/** Curated Phosphor icon names available to both the admin picker and the learner renderer. */
export const BADGE_ICON_NAMES = [
  "BookOpen",
  "Fire",
  "Lightning",
  "Star",
  "Trophy",
  "Medal",
  "Crown",
  "Rocket",
  "Target",
  "Heart",
  "Confetti",
  "GraduationCap",
  "Lightbulb",
  "Sparkle",
  "Flag",
  "CheckCircle",
] as const;

/**
 * The original hardcoded six badges, expressed as config. Used as the fallback
 * whenever an institute has not configured its own set yet, so behaviour is
 * unchanged until an admin customises it.
 */
export const DEFAULT_BADGE_CONFIG: BadgesRewardsConfig = {
  version: 1,
  enabled: false,
  scoring: DEFAULT_SCORING,
  badges: [
    {
      id: "first_course",
      name: "First Steps",
      description: "Enrol in your first course",
      icon: "lib:first_steps-bronze",
      trigger: "course_count",
      threshold: 1,
      enabled: true,
    },
    {
      id: "streak_7",
      name: "On Fire",
      description: "Maintain a 7-day streak",
      icon: "lib:streak-silver",
      trigger: "streak",
      threshold: 7,
      enabled: true,
    },
    {
      id: "streak_30",
      name: "Unstoppable",
      description: "Maintain a 30-day streak",
      icon: "lib:streak-gold",
      trigger: "streak",
      threshold: 30,
      enabled: true,
    },
    {
      id: "perfect_score",
      name: "Perfect Score",
      description: "Score 100% on an assessment",
      icon: "lib:xp_master-gold",
      trigger: "assessment_score",
      threshold: 100,
      enabled: true,
    },
    {
      id: "completionist",
      name: "Completionist",
      description: "Finish a course at 100%",
      icon: "lib:completionist-gold",
      trigger: "course_completion",
      threshold: 100,
      enabled: true,
    },
    {
      id: "dedicated_learner",
      name: "Dedicated Learner",
      description: "Earn 1,000 XP total",
      icon: "lib:xp_master-diamond",
      trigger: "xp_total",
      threshold: 1000,
      enabled: true,
    },
  ],
};

/** Defensive normaliser — drops malformed entries and coerces fields to safe values. */
function normalizeConfig(raw: unknown): BadgesRewardsConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const badgesRaw = (raw as { badges?: unknown }).badges;
  if (!Array.isArray(badgesRaw)) return null;

  const badges: BadgeDefinitionConfig[] = [];
  for (const b of badgesRaw) {
    if (!b || typeof b !== "object") continue;
    const item = b as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.trigger !== "string") continue;
    badges.push({
      id: item.id,
      name: typeof item.name === "string" ? item.name : "Badge",
      description: typeof item.description === "string" ? item.description : "",
      icon: typeof item.icon === "string" ? item.icon : "Trophy",
      trigger: item.trigger as BadgeTriggerType,
      threshold: Number.isFinite(Number(item.threshold)) ? Number(item.threshold) : 0,
      enabled: item.enabled !== false,
      // Whitelist — any new schema field must be carried here or it is silently dropped.
      hidden: item.hidden === true,
    });
  }
  if (badges.length === 0) return null;
  // Master toggle defaults to OFF when absent — institutes must opt in.
  const enabled = (raw as { enabled?: unknown }).enabled === true;
  return { version: 1, enabled, badges };
}

/**
 * Raw BADGES_REWARDS_SETTING blob, fetched FRESH from the backend (memoized for a
 * few seconds) with a cached-settings fallback — so toggling the feature in the
 * admin reaches the learner on the next dashboard load, without re-login.
 */
type RawBadgesBlob = { enabled?: unknown; scoring?: unknown; badges?: unknown } | null;

let badgesBlobCache: { value: Promise<RawBadgesBlob>; at: number } | null = null;
const BADGES_BLOB_TTL_MS = 10_000;

function getBadgesBlob(): Promise<RawBadgesBlob> {
  const now = Date.now();
  if (badgesBlobCache && now - badgesBlobCache.at < BADGES_BLOB_TTL_MS) {
    return badgesBlobCache.value;
  }
  const value = (async (): Promise<RawBadgesBlob> => {
    try {
      const instituteId = await getInstituteId();
      if (instituteId) {
        const res = await authenticatedAxiosInstance.get(
          `${BASE_URL}/admin-core-service/institute/setting/v1/get`,
          { params: { instituteId, settingKey: BADGES_REWARDS_SETTING_KEY } }
        );
        const blob = res?.data?.data;
        if (blob && typeof blob === "object") return blob as RawBadgesBlob;
      }
    } catch {
      /* fall through to the cached institute settings */
    }
    try {
      const settings = await instituteSettingsCache.getCachedSettings();
      return (settings?.[BADGES_REWARDS_SETTING_KEY]?.data ?? null) as RawBadgesBlob;
    } catch {
      return null;
    }
  })();
  badgesBlobCache = { value, at: now };
  return value;
}

/**
 * Read the institute's badge config (fresh from the backend, with a cache
 * fallback), defaulting to {@link DEFAULT_BADGE_CONFIG}. Only enabled badges returned.
 */
export async function getBadgeConfig(): Promise<BadgesRewardsConfig> {
  try {
    const data = await getBadgesBlob();
    const normalized = normalizeConfig(data);
    const config = normalized ?? DEFAULT_BADGE_CONFIG;
    // Master toggle is read from the raw blob so it's respected even when the
    // badge list is empty (normalizeConfig returns null in that case).
    // Defaults to OFF — only ON when the institute explicitly enabled it.
    const enabled = (data as { enabled?: unknown })?.enabled === true;
    return { ...config, enabled, badges: config.badges.filter((b) => b.enabled) };
  } catch {
    return DEFAULT_BADGE_CONFIG;
  }
}

/** Read the institute's points-per-action scoring (defaults applied per field). */
export async function getScoringConfig(): Promise<ScoringConfig> {
  try {
    const raw = (await getBadgesBlob())?.scoring as Partial<ScoringConfig> | undefined;
    if (!raw) return DEFAULT_SCORING;
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
    return {
      activityPerDay: num(raw.activityPerDay, DEFAULT_SCORING.activityPerDay),
      streakPerDay: num(raw.streakPerDay, DEFAULT_SCORING.streakPerDay),
      liveClassAttended: num(raw.liveClassAttended, DEFAULT_SCORING.liveClassAttended),
      courseCompletion: num(raw.courseCompletion, DEFAULT_SCORING.courseCompletion),
      assessmentBestScore: num(raw.assessmentBestScore, DEFAULT_SCORING.assessmentBestScore),
    };
  } catch {
    return DEFAULT_SCORING;
  }
}

/** Master toggle for the whole badges + leaderboard feature (defaults to OFF). */
export async function getBadgesEnabled(): Promise<boolean> {
  try {
    const data = await getBadgesBlob();
    return (data as { enabled?: unknown } | null)?.enabled === true;
  } catch {
    return false;
  }
}

/** True if any enabled badge needs assessment-score data (gates the lazy fetch). */
export function configNeedsAssessmentScore(config: BadgesRewardsConfig): boolean {
  return config.badges.some((b) => b.enabled && b.trigger === "assessment_score");
}

/** True if any enabled badge needs live-session attendance data (gates the lazy fetch). */
export function configNeedsLiveSession(config: BadgesRewardsConfig): boolean {
  return config.badges.some(
    (b) =>
      b.enabled &&
      (b.trigger === "live_session_count" || b.trigger === "live_session_streak")
  );
}
