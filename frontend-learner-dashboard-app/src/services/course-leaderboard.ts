import axios from "axios";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";

/**
 * Course/batch leaderboard for the learner. Ranks peers by learning activity
 * (engagement minutes) and shows each learner's badge count. The learner-facing
 * endpoint returns anonymized names (initials) with the caller's own row marked.
 */
export interface LeaderboardBadge {
  name: string;
  icon: string;
}

export interface LeaderboardEntry {
  rank: number | null;
  userId: string | null;
  name: string;
  points: number;
  badgeCount: number;
  badges: LeaderboardBadge[];
  currentUser: boolean;
}

export interface CourseLeaderboardData {
  totalLearners: number;
  entries: LeaderboardEntry[];
  currentUser: LeaderboardEntry | null;
  /** Course/batch name — present on the public shareable response. */
  courseName?: string | null;
  /** Institute branding — present on the public response so the page renders on ANY domain. */
  instituteName?: string | null;
  instituteLogoFileId?: string | null;
  instituteThemeCode?: string | null;
  /** Whether names are anonymized (initials) — admin-configurable for the public page. */
  anonymized?: boolean;
}

/** The learner's own gamification summary for their profile. */
export interface LearnerSummary {
  totalBadges: number;
  bestRank: number | null;
  badges: LeaderboardBadge[];
}

/**
 * Ranking metric. POINTS reads points_ledger — engagement answers, activity days and
 * streak bonuses, all server-side and comparable between learners. ACTIVITY is the
 * legacy ranking by raw focused minutes, which no configured scoring ever touched.
 */
const LEADERBOARD_METRIC = "POINTS";

export async function fetchCourseLeaderboard(
  packageSessionId: string
): Promise<CourseLeaderboardData | null> {
  try {
    const instituteId = await getInstituteId();
    if (!instituteId || !packageSessionId) return null;
    const { data } = await authenticatedAxiosInstance.get(
      `${BASE_URL}/admin-core-service/leaderboard/v1/course/me`,
      { params: { packageSessionId, instituteId, metric: LEADERBOARD_METRIC } }
    );
    return (data as CourseLeaderboardData) ?? null;
  } catch (error) {
    console.error("[course-leaderboard] fetch failed:", error);
    return null;
  }
}

/**
 * PUBLIC, no-auth course leaderboard for the shareable page. Uses plain axios
 * (no token) and returns fully-anonymized data + the course name.
 */
export async function fetchPublicCourseLeaderboard(
  packageSessionId: string,
  instituteId?: string | null
): Promise<CourseLeaderboardData | null> {
  try {
    if (!packageSessionId) return null;
    // instituteId is an optional hint — the backend derives the institute from the
    // packageSessionId, so the link works on ANY domain (generic learner.vacademy.io too).
    const { data } = await axios.get(
      `${BASE_URL}/admin-core-service/public/leaderboard/v1/course/${packageSessionId}`,
      { params: instituteId ? { instituteId } : {} }
    );
    return (data as CourseLeaderboardData) ?? null;
  } catch (error) {
    console.error("[public-leaderboard] fetch failed:", error);
    return null;
  }
}

/**
 * Public, no-auth institute-WIDE leaderboard (all courses combined) for the
 * shareable page. Fully anonymized; gated server-side by the institute toggle.
 */
export async function fetchPublicInstituteLeaderboard(
  instituteId: string
): Promise<CourseLeaderboardData | null> {
  try {
    if (!instituteId) return null;
    const { data } = await axios.get(
      `${BASE_URL}/admin-core-service/public/leaderboard/v1/institute/${instituteId}`
    );
    return (data as CourseLeaderboardData) ?? null;
  } catch (error) {
    console.error("[public-institute-leaderboard] fetch failed:", error);
    return null;
  }
}

/** The authenticated learner's own institute-WIDE rank (across all their courses). */
export async function fetchMyInstituteRank(): Promise<
  { rank: number | null; totalLearners: number } | null
> {
  try {
    const instituteId = await getInstituteId();
    if (!instituteId) return null;
    const { data } = await authenticatedAxiosInstance.get(
      `${BASE_URL}/admin-core-service/leaderboard/v1/institute/me`,
      { params: { instituteId, metric: LEADERBOARD_METRIC } }
    );
    const d = data as CourseLeaderboardData;
    return { rank: d?.currentUser?.rank ?? null, totalLearners: d?.totalLearners ?? 0 };
  } catch (error) {
    console.error("[institute-rank] fetch failed:", error);
    return null;
  }
}

/** The authenticated learner's own badges + best rank (for the profile). */
export async function fetchLearnerSummary(): Promise<LearnerSummary | null> {
  try {
    const instituteId = await getInstituteId();
    if (!instituteId) return null;
    const { data } = await authenticatedAxiosInstance.get(
      `${BASE_URL}/admin-core-service/leaderboard/v1/my-summary`,
      { params: { instituteId } }
    );
    return (data as LearnerSummary) ?? null;
  } catch (error) {
    console.error("[learner-summary] fetch failed:", error);
    return null;
  }
}
