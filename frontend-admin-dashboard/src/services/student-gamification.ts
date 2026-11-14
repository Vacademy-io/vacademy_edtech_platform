import { queryOptions } from '@tanstack/react-query';
import { BASE_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

const POINTS_BASE = `${BASE_URL}/admin-core-service/points/v1/learner`;

export interface PointsBreakdownItem {
    key: string;
    label: string;
    points: number;
}

export interface LearnerPointsSummary {
    totalPoints: number;
    weekPoints: number;
    todayPoints: number;
    level: number;
    pointsToNextLevel: number;
    breakdown: PointsBreakdownItem[];
    /** Null when the streak could not be computed, never a false 0. */
    currentStreak: number | null;
    longestStreak: number | null;
    keptToday: boolean | null;
    last7Days: { date: string; active: boolean }[] | null;
    today: string | null;
}

export interface LearnerPointsAward {
    id: string;
    sourceType: string;
    label: string;
    points: number;
    reason: string | null;
    awardedAt: string | null;
}

export interface LearnerPointsHistory {
    /** Newest first. */
    recent: LearnerPointsAward[];
    /** Last 12 weeks, oldest first, empty weeks included. */
    weeks: { weekStart: string; points: number }[];
    /** yyyy-MM-dd days with activity in the last six months. */
    activeDays: string[];
    today: string;
}

/** Must match POINTS_PER_LEVEL in the backend PointsLedgerService. */
export const POINTS_PER_LEVEL = 500;

export const getLearnerPointsSummaryQuery = (userId: string, instituteId: string) =>
    queryOptions({
        queryKey: ['LEARNER_POINTS_SUMMARY', userId, instituteId],
        queryFn: async () => {
            const { data } = await authenticatedAxiosInstance.get<LearnerPointsSummary>(
                `${POINTS_BASE}/summary`,
                { params: { userId, instituteId } }
            );
            return data;
        },
        enabled: !!userId && !!instituteId,
        staleTime: 60_000,
    });

export const getLearnerPointsHistoryQuery = (userId: string, instituteId: string) =>
    queryOptions({
        queryKey: ['LEARNER_POINTS_HISTORY', userId, instituteId],
        queryFn: async () => {
            const { data } = await authenticatedAxiosInstance.get<LearnerPointsHistory>(
                `${POINTS_BASE}/history`,
                { params: { userId, instituteId } }
            );
            return data;
        },
        enabled: !!userId && !!instituteId,
        staleTime: 60_000,
    });
