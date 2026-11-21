import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { buildCrmWindow, type CrmRangeDays } from '../-utils/crm-dashboard';
import {
    fetchCrmDashboard,
    isEmptyBlock,
    type CrmBlockId,
    type CrmDashboardBlocks,
    type CrmDuplicateFilter,
} from './crm-dashboard';

/**
 * CRM Dashboard blocks for an enhanced page header. Same endpoint and cache as the
 * CRM Dashboard (server caches per scope for 3 minutes; here 5 minutes, no refetch
 * on focus); keyed on calendar days, so revisiting a page within minutes is free.
 */
export function useCrmDashboardBlocks(
    blocks: CrmBlockId[],
    opts: {
        /** Default true. */
        enabled?: boolean;
        audienceId?: string;
        /** Team narrowing (Sales Dashboard); the server intersects it with the caller's scope. */
        teamId?: string;
        /** Lead status keys to keep / drop (CSV), so a header matches a status-filtered list. */
        leadStatusId?: string;
        leadStatusExcludeId?: string;
        /** Duplicate leads, as the list's duplicates= (AUTO = the list's default). */
        duplicateFilter?: CrmDuplicateFilter;
        rangeDays?: CrmRangeDays;
    } = {}
) {
    const instituteId = getCurrentInstituteId() || '';
    const [stamp] = useState(() => Date.now());
    const window = useMemo(
        () => buildCrmWindow(opts.rangeDays ?? 30, new Date(stamp)),
        [opts.rangeDays, stamp]
    );
    const q = useQuery({
        // Calendar days, not the exact minute, so a revisit within minutes is free.
        // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the minute-level window fields are left out on purpose
        queryKey: [
            'crm-dashboard',
            instituteId,
            window.fromDay,
            window.toDay,
            blocks,
            opts.audienceId ?? '',
            opts.teamId ?? '',
            opts.leadStatusId ?? '',
            opts.leadStatusExcludeId ?? '',
            opts.duplicateFilter ?? '',
        ],
        queryFn: () =>
            fetchCrmDashboard({
                institute_id: instituteId,
                from: window.from,
                to: window.to,
                timezone: window.timezone,
                now: window.now,
                today_end: window.todayEnd,
                audience_id: opts.audienceId,
                team_id: opts.teamId || undefined,
                lead_status_id: opts.leadStatusId || undefined,
                lead_status_exclude_id: opts.leadStatusExcludeId || undefined,
                duplicate_filter: opts.duplicateFilter,
                blocks,
            }),
        enabled: (opts.enabled ?? true) && !!instituteId && blocks.length > 0,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
    });
    function pick<T>(id: CrmBlockId): T | undefined {
        const b = q.data?.blocks?.[id as keyof CrmDashboardBlocks];
        return b === undefined || isEmptyBlock(b) ? undefined : (b as T);
    }
    return { data: q.data, window, isLoading: q.isLoading && q.fetchStatus !== 'idle', pick };
}
