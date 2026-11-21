import { queryOptions } from '@tanstack/react-query';
import { BASE_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

export interface GamificationOverview {
    totalPoints: number;
    learnersEarning: number;
    badgesAwarded: number;
    learnersWithBadge: number;
    granularity: 'DAY' | 'WEEK' | 'MONTH' | null;
    /** Oldest first, empty periods included. */
    periods: { start: string; end: string; points: number; badges: number }[];
    /** Highest first. */
    sources: { key: string; label: string; points: number }[];
    /** Highest first. */
    topEarners: { userId: string; fullName: string; points: number }[];
    /** Most awarded first. */
    badges: { name: string; icon: string | null; awards: number; learners: number }[];
    /** Newest first. */
    recentBadges: {
        userId: string;
        fullName: string;
        badgeName: string;
        badgeIcon: string | null;
        awardedAt: string | null;
    }[];
}

export const getGamificationOverviewQuery = (params: {
    instituteId: string;
    /** Empty means every batch of the institute. */
    packageSessionIds: string[];
    startDate: string;
    endDate: string;
}) =>
    queryOptions({
        queryKey: ['GAMIFICATION_OVERVIEW', params],
        queryFn: async () => {
            const { data } = await authenticatedAxiosInstance.get<GamificationOverview>(
                `${BASE_URL}/admin-core-service/points/v1/overview`,
                {
                    params: {
                        instituteId: params.instituteId,
                        startDate: params.startDate,
                        endDate: params.endDate,
                        ...(params.packageSessionIds.length > 0
                            ? { packageSessionIds: params.packageSessionIds.join(',') }
                            : {}),
                    },
                }
            );
            return data;
        },
        enabled: !!params.instituteId,
        staleTime: 60_000,
    });
