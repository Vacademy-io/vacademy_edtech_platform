import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export type GroupDashboardId = 'contacts' | 'automations' | 'engagement';
export type GroupRangeDays = 7 | 30 | 90;
export const GROUP_RANGE_OPTIONS: GroupRangeDays[] = [7, 30, 90];

export interface GroupDashboardResponse<S> {
    group: GroupDashboardId;
    days: number;
    from_day: string;
    to_day: string;
    sections: Partial<S>;
    errors: Record<string, string>;
    generated_at: string;
}

export interface ContactsSections {
    summary: {
        learners: number;
        active_learners: number;
        invited_learners: number;
        leads: number;
        both_count: number;
        new_learners: number;
        new_leads: number;
        prev_new_learners: number;
        prev_new_leads: number;
        tagged: number;
    };
    daily: Array<{ day: string; learners: number; leads: number }>;
    tags: Array<{ tag_id: string; name: string; users: number }>;
}

export interface AutomationsSections {
    totals: {
        runs: number;
        failed: number;
        prev_runs: number;
        prev_failed: number;
        workflows_ran: number;
        active_workflows: number;
        total_workflows: number;
    };
    daily: Array<{ day: string; runs: number; failed: number }>;
    workflows: Array<{
        workflow_id: string;
        name: string;
        status: string;
        runs: number;
        failed: number;
        last_failed_at: string | number | null;
        last_error: string | null;
    }>;
}

export interface EngagementSections {
    totals: {
        drafted: number;
        completed: number;
        failed: number;
        expired: number;
        prev_drafted: number;
        prev_completed: number;
        open_now: number;
        open_over_day: number;
    };
    daily: Array<{ day: string; drafted: number; completed: number }>;
    engines: Array<{
        engine_id: string;
        name: string;
        status: string;
        members: number;
        holdout: number;
        drafted: number;
        completed: number;
        failed: number;
    }>;
}

export const fetchGroupDashboard = async <S>(
    group: GroupDashboardId,
    instituteId: string,
    days: GroupRangeDays
): Promise<GroupDashboardResponse<S>> => {
    const res = await authenticatedAxiosInstance.get<GroupDashboardResponse<S>>(
        `${BASE_URL}/admin-core-service/v1/group-dashboard/${group}`,
        {
            params: {
                instituteId,
                days,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
        }
    );
    // A response without sections (older server, proxy error page) renders empty
    // cards rather than crashing the page.
    return { ...res.data, sections: res.data?.sections ?? {}, errors: res.data?.errors ?? {} };
};

/**
 * One group dashboard. The server caches each section per institute for 3 minutes;
 * here 5 minutes and no refetch on focus, so revisiting the page is free.
 */
export function useGroupDashboard<S>(
    group: GroupDashboardId,
    days: GroupRangeDays,
    enabled: boolean
) {
    const instituteId = getCurrentInstituteId() || '';
    return useQuery({
        queryKey: ['group-dashboard', group, instituteId, days],
        queryFn: () => fetchGroupDashboard<S>(group, instituteId, days),
        enabled: enabled && !!instituteId,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
    });
}
