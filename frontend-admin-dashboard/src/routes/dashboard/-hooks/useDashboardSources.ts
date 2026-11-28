import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_USER_ROLES_COUNT } from '@/constants/urls';
import {
    fetchDashboardCollectionData,
    fetchPendingAdjustments,
    getCollectionDashboardQueryKey,
    getPendingAdjustmentsQueryKey,
    type DashboardCollectionRequest,
} from '@/services/manage-finances';
import { getSystemAlertsQuery } from '@/services/notifications/system-alerts';
import { useUpcomingSessions } from '@/routes/study-library/live-session/-hooks/useLiveSessions';
import { getInstituteDashboardData } from '../-services/dashboard-services';

/**
 * Every data source the dashboard reads more than once, as one hook each.
 *
 * Several widgets show different slices of the same data (KPI band, finance snapshot and
 * pending actions all read fee data; KPI band and Live Classes both read today's
 * sessions). Each slice used to fetch its own copy, so one dashboard load sent the same
 * request up to four times. Going through these hooks gives every reader the same query
 * key and options, so React Query sends each request once and shares the result.
 */

const DASHBOARD_STALE_MS = 60_000;

/** Institute counts (learners/courses/batches). Same key + options as the page header. */
export const useInstituteDashboardCounts = (instituteId: string | undefined, enabled = true) =>
    useQuery({
        ...getInstituteDashboardData(instituteId),
        enabled: enabled && !!instituteId,
        retry: 1,
    });

/** Today/upcoming live sessions — shared by the KPI band and the Live Classes widget. */
export const useDashboardUpcomingSessions = (instituteId: string, enabled = true) =>
    useUpcomingSessions(instituteId, {
        staleTime: DASHBOARD_STALE_MS,
        enabled: enabled && !!instituteId,
    });

/**
 * Bills whose concession/penalty awaits approval. Same key as the Adjustment Approvals page,
 * so approving there invalidates this too. NOTE: this is ONLY pending-approval bills — it is
 * not a source of outstanding or overdue dues (use useInstituteFeeCollection for those).
 */
export const usePendingAdjustments = (instituteId: string, enabled = true) =>
    useQuery({
        queryKey: getPendingAdjustmentsQueryKey(),
        queryFn: fetchPendingAdjustments,
        staleTime: DASHBOARD_STALE_MS,
        retry: false,
        enabled: enabled && !!instituteId,
    });

/** The Collection Dashboard page's default request: whole institute, all sessions/fee types. */
export const instituteWideCollectionRequest = (
    instituteId: string
): DashboardCollectionRequest => ({
    instituteId,
    sessionId: '',
    feeTypeIds: [],
});

/**
 * Institute-wide projected / collected / overdue totals — the same endpoint and request the
 * Fee Management → Collection page opens with, so the dashboard and that page agree (and
 * share a cache entry).
 */
export const useInstituteFeeCollection = (instituteId: string, enabled = true) => {
    const request = instituteWideCollectionRequest(instituteId);
    return useQuery({
        queryKey: getCollectionDashboardQueryKey(request),
        queryFn: () => fetchDashboardCollectionData(request),
        staleTime: DASHBOARD_STALE_MS,
        retry: false,
        enabled: enabled && !!instituteId,
    });
};

interface RoleCountRow {
    role_name?: string;
    roleName?: string;
    user_count?: number;
    userCount?: number;
}

/**
 * Sum of all non-student users at the institute. The count endpoint groups by role across
 * the institute (excluding STUDENT) and so includes any custom roles.
 */
export const useTeamMemberCount = (instituteId: string, enabled = true) =>
    useQuery({
        queryKey: ['DASHBOARD_TEAM_MEMBER_COUNT', instituteId],
        queryFn: async () => {
            const res = await authenticatedAxiosInstance({
                method: 'GET',
                url: GET_USER_ROLES_COUNT,
                params: { instituteId },
            });
            const rows = res.data as RoleCountRow[];
            if (!Array.isArray(rows)) return 0;
            return rows.reduce((sum, row) => sum + Number(row.user_count ?? row.userCount ?? 0), 0);
        },
        staleTime: DASHBOARD_STALE_MS,
        retry: false,
        enabled: enabled && !!instituteId,
    });

/**
 * The latest five system alerts — the SAME query (key and size) the navbar bell polls, so
 * the dashboard adds no request of its own. fetchSystemAlerts never rejects; a failed fetch
 * comes back as an empty page with `fetchFailed: true`.
 */
export const useSystemAlertsPreview = (userId: string) =>
    useQuery({ ...getSystemAlertsQuery(userId, 5), enabled: !!userId });
