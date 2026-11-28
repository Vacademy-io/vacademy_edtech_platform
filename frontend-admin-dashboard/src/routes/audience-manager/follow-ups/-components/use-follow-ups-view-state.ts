import { useMemo } from 'react';
import { format } from 'date-fns';
import { useNavigate, useSearch } from '@tanstack/react-router';

/**
 * URL-driven view state for the Follow-ups page.
 *
 * Extracted into a hook so the page component stays small (CodeFactor's
 * cyclomatic-complexity check fired when this logic was inline). All sub-view
 * state lives on the URL so deep-links restore the same view.
 *
 *   view        — 'list' (default) | 'calendar'
 *   monthStr    — yyyy-MM (local) for the calendar's month
 *   selectedDateStr — yyyy-MM-dd (local) for the calendar's selected day
 *   counsellorFilters — userIds; the URL carries them comma-separated and an
 *                       empty list means "all counsellors" (param omitted)
 */
export type FollowUpsView = 'list' | 'calendar';

export interface FollowUpsViewState {
    view: FollowUpsView;
    setView: (v: FollowUpsView) => void;
    monthStr: string;
    setMonthStr: (m: string) => void;
    selectedDateStr: string;
    setSelectedDateStr: (d: string) => void;
    counsellorFilters: string[];
    setCounsellorFilters: (v: string[]) => void;
}

export const useFollowUpsViewState = (): FollowUpsViewState => {
    const search = useSearch({ from: '/audience-manager/follow-ups/' });
    const navigate = useNavigate({ from: '/audience-manager/follow-ups/' });

    const view: FollowUpsView = search.view ?? 'list';
    const monthStr = search.month ?? format(new Date(), 'yyyy-MM');
    const selectedDateStr = search.date ?? format(new Date(), 'yyyy-MM-dd');
    // A single ?counsellor=<id> link still parses — it is just a one-item list.
    const counsellorFilters = useMemo(
        () => (search.counsellor ? search.counsellor.split(',').filter(Boolean) : []),
        [search.counsellor]
    );

    const setView = (v: FollowUpsView) =>
        navigate({ search: (prev) => ({ ...prev, view: v === 'list' ? undefined : v }) });
    const setMonthStr = (m: string) => navigate({ search: (prev) => ({ ...prev, month: m }) });
    const setSelectedDateStr = (d: string) =>
        navigate({ search: (prev) => ({ ...prev, date: d }) });
    const setCounsellorFilters = (v: string[]) =>
        navigate({
            search: (prev) => ({
                ...prev,
                counsellor: v.length > 0 ? v.join(',') : undefined,
            }),
        });

    return {
        view,
        setView,
        monthStr,
        setMonthStr,
        selectedDateStr,
        setSelectedDateStr,
        counsellorFilters,
        setCounsellorFilters,
    };
};
