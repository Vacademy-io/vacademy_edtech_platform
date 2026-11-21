import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useLeadProfiles } from '@/hooks/use-lead-profiles';
import type { LeadCardVM } from './lead-view-model';
import type { LeadActionHandlers } from './lead-actions';
import type { StageAccent } from './lead-stage-chip';
import type { LeadBoardColumnConfig } from './lead-board-config';
import { LeadCard } from './lead-card';

/**
 * LeadBoardColumn — one Kanban column. Owns its own paged fetch (read-only,
 * via the surface's list fetcher with the column's filter params) and enriches
 * its visible cards from the cached lead-profiles batch. "Load more" appends the
 * next page until the backend reports `last`.
 */

const BOARD_PAGE_SIZE = 20;

const ACCENT_DOT: Record<StageAccent, string> = {
    red: 'bg-red-500',
    amber: 'bg-amber-500',
    blue: 'bg-blue-500',
    emerald: 'bg-emerald-500',
    neutral: 'bg-neutral-400',
};

interface BoardPage {
    content: unknown[];
    last: boolean;
}

interface LeadBoardColumnProps {
    config: LeadBoardColumnConfig;
    fetchFn: (payload: Record<string, unknown>) => Promise<BoardPage>;
    /** scope + active date/search filters; NOT tier/conversion/page/size. */
    basePayload: Record<string, unknown>;
    surfaceId: string;
    scopeId: string;
    /** Header count from the KPI strip (falls back to loaded card count). */
    count?: number;
    showScore: boolean;
    showOps: boolean;
    /** Raw API lead → view-model adapter (recentLeadToVM works for both surfaces). */
    toVM: (raw: unknown) => LeadCardVM;
    actions: LeadActionHandlers;
}

export function LeadBoardColumn({
    config,
    fetchFn,
    basePayload,
    surfaceId,
    scopeId,
    count,
    showScore,
    showOps,
    toVM,
    actions,
}: LeadBoardColumnProps) {
    const baseKey = JSON.stringify(basePayload);

    const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
        useInfiniteQuery({
            // baseKey serializes basePayload and config.id identifies the column's
            // params, so the key fully captures both.
            // eslint-disable-next-line @tanstack/query/exhaustive-deps
            queryKey: ['lead-board', surfaceId, scopeId, baseKey, config.id],
            queryFn: ({ pageParam }) =>
                fetchFn({
                    ...basePayload,
                    ...config.params,
                    page: pageParam,
                    size: BOARD_PAGE_SIZE,
                }),
            initialPageParam: 0,
            getNextPageParam: (lastPage, allPages) => (lastPage.last ? undefined : allPages.length),
            enabled: !!scopeId,
            staleTime: 30 * 1000,
        });

    const vms = useMemo(
        () => (data?.pages ?? []).flatMap((p) => p.content).map((raw) => toVM(raw)),
        [data, toVM]
    );

    const userIds = useMemo(
        () => vms.map((v) => v.userId).filter((id): id is string => !!id),
        [vms]
    );
    const { profiles } = useLeadProfiles(userIds, showOps || showScore);

    const headerCount = count ?? vms.length;

    return (
        <div className="flex w-72 shrink-0 flex-col rounded-xl border border-neutral-200 bg-neutral-50/60">
            <header className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'size-2 rounded-full',
                            !config.color && ACCENT_DOT[config.accent]
                        )}
                        style={config.color ? { backgroundColor: config.color } : undefined}
                    />
                    <span className="text-sm font-semibold text-neutral-700">{config.label}</span>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-neutral-500">
                    {headerCount}
                </span>
            </header>

            <div className="space-y-2 px-2 pb-2">
                {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-32 w-full rounded-lg" />
                    ))
                ) : isError ? (
                    <p className="px-1 py-6 text-center text-xs text-red-500">Failed to load.</p>
                ) : vms.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-neutral-400">No leads here.</p>
                ) : (
                    vms.map((vm) => (
                        <LeadCard
                            key={vm.key}
                            vm={vm}
                            profile={vm.userId ? profiles[vm.userId] : undefined}
                            showScore={showScore}
                            showOps={showOps}
                            actions={actions}
                        />
                    ))
                )}

                {hasNextPage && (
                    <button
                        type="button"
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="w-full rounded-lg border border-dashed border-neutral-300 py-2 text-xs font-medium text-neutral-500 hover:border-primary-300 hover:text-primary-600 disabled:opacity-60"
                    >
                        {isFetchingNextPage ? 'Loading…' : 'Load more'}
                    </button>
                )}
            </div>
        </div>
    );
}
