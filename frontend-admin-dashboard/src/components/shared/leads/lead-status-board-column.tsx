import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ArrowsDownUp, CircleNotch } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useLeadProfiles } from '@/hooks/use-lead-profiles';
import { NO_STATUS_KEY, type LeadStatus } from '@/hooks/use-lead-statuses';
import { MyDropdown } from '@/components/design-system/dropdown';
import type { LeadCardVM } from './lead-view-model';
import type { LeadActionHandlers } from './lead-actions';
import { LeadCard } from './lead-card';

/**
 * LeadStatusBoardColumn — one status column of the drag-and-drop lead board.
 * Owns its own infinite fetch (the surface's list fetcher narrowed to this
 * status via `lead_status_id`) and acts as a dnd-kit drop target keyed by the
 * status_key. Scrolling near the bottom auto-loads the next page.
 */

const BOARD_PAGE_SIZE = 20;

/** Per-column sort choice; maps to the backend sort params below. */
export type BoardColumnSort = 'RECENT' | 'NAME';

export const BOARD_SORT_PARAMS: Record<
    BoardColumnSort,
    { sort_by: string; sort_direction: 'ASC' | 'DESC' }
> = {
    RECENT: { sort_by: 'SUBMITTED_AT', sort_direction: 'DESC' },
    // PARENT_NAME = the name submitted on the lead form (see AudienceResponseRepository).
    NAME: { sort_by: 'PARENT_NAME', sort_direction: 'ASC' },
};

const SORT_LABELS: Record<BoardColumnSort, string> = {
    RECENT: 'Recent first',
    NAME: 'Name A–Z',
};

interface BoardPage {
    content: unknown[];
    last: boolean;
    totalElements: number;
}

interface LeadStatusBoardColumnProps {
    status: LeadStatus;
    fetchFn: (payload: Record<string, unknown>) => Promise<BoardPage>;
    /** Scope + shared filters; NOT status/sort/page/size (the column owns those). */
    basePayload: Record<string, unknown>;
    surfaceId: string;
    scopeId: string;
    sort: BoardColumnSort;
    onSortChange: (sort: BoardColumnSort) => void;
    showScore: boolean;
    showOps: boolean;
    /** Raw API lead → view-model adapter (recentLeadToVM for the leads surfaces). */
    toVM: (raw: unknown) => LeadCardVM;
    actions: LeadActionHandlers;
    /** Cards optimistically moved INTO this column (rendered on top until the refetch lands). */
    pendingIn: LeadCardVM[];
    /** Keys of cards optimistically moved OUT of this column (hidden until the refetch lands). */
    pendingOutKeys: Set<string>;
    /** Key of the card currently being dragged (dimmed in place). */
    activeDragKey: string | null;
}

/** Draggable wrapper — the whole card is the drag handle; a plain click still
 *  opens the side view because the DndContext's PointerSensor requires ~8px of
 *  movement before a drag activates. Cards without a responseId can't have
 *  their status changed, so they aren't draggable. */
function DraggableLeadCard({
    vm,
    columnKey,
    dimmed,
    children,
}: {
    vm: LeadCardVM;
    columnKey: string;
    dimmed: boolean;
    children: React.ReactNode;
}) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: vm.key,
        data: { vm, fromKey: columnKey },
        disabled: !vm.responseId,
    });
    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            className={cn(
                vm.responseId && 'cursor-grab active:cursor-grabbing',
                (isDragging || dimmed) && 'opacity-40'
            )}
        >
            {children}
        </div>
    );
}

export function LeadStatusBoardColumn({
    status,
    fetchFn,
    basePayload,
    surfaceId,
    scopeId,
    sort,
    onSortChange,
    showScore,
    showOps,
    toVM,
    actions,
    pendingIn,
    pendingOutKeys,
    activeDragKey,
}: LeadStatusBoardColumnProps) {
    const { t: tPages } = useTranslation('crmPages');
    const baseKey = JSON.stringify(basePayload);
    const sortParams = BOARD_SORT_PARAMS[sort];

    const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
        useInfiniteQuery({
            // baseKey serializes basePayload; status_key + sort identify the
            // column's own params, so the key fully captures the request.
            // eslint-disable-next-line @tanstack/query/exhaustive-deps
            queryKey: ['lead-board', surfaceId, scopeId, baseKey, status.status_key, sort],
            queryFn: ({ pageParam }) =>
                fetchFn({
                    ...basePayload,
                    lead_status_id: status.status_key,
                    ...sortParams,
                    page: pageParam,
                    size: BOARD_PAGE_SIZE,
                }),
            initialPageParam: 0,
            getNextPageParam: (lastPage, allPages) => (lastPage.last ? undefined : allPages.length),
            enabled: !!scopeId,
            staleTime: 30 * 1000,
        });

    const pendingInKeys = useMemo(() => new Set(pendingIn.map((v) => v.key)), [pendingIn]);
    const vms = useMemo(() => {
        const fetched = (data?.pages ?? []).flatMap((p) => p.content).map((raw) => toVM(raw));
        // Hide cards dragged away; dedupe cards dragged in (the refetch may have
        // already landed while the optimistic entry is still present).
        const kept = fetched.filter((v) => !pendingOutKeys.has(v.key) && !pendingInKeys.has(v.key));
        return [...pendingIn, ...kept];
    }, [data, toVM, pendingIn, pendingInKeys, pendingOutKeys]);

    const userIds = useMemo(
        () => vms.map((v) => v.userId).filter((id): id is string => !!id),
        [vms]
    );
    const { profiles } = useLeadProfiles(userIds, showOps || showScore);

    const totalElements = data?.pages[0]?.totalElements;
    const headerCount =
        totalElements != null
            ? Math.max(0, totalElements - pendingOutKeys.size + pendingIn.length)
            : vms.length;

    // Drop target — the droppable id is the status_key the board resolves on drop.
    // The synthetic "No status" column only collects never-staged leads; a lead
    // can leave it but never be dropped back in (there is no status to assign).
    const { setNodeRef: setDropRef, isOver } = useDroppable({
        id: status.status_key,
        disabled: status.status_key === NO_STATUS_KEY,
    });

    // Infinite scroll: a sentinel near the bottom of the column's own scroll
    // area requests the next page as it comes into view.
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el || !hasNextPage) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) {
                    void fetchNextPage();
                }
            },
            { root: scrollRef.current, rootMargin: '200px' }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    return (
        <div
            ref={setDropRef}
            className={cn(
                'flex h-full w-72 shrink-0 flex-col rounded-xl border bg-neutral-50/60 transition-colors',
                isOver ? 'border-primary-400 bg-primary-50/60' : 'border-neutral-200'
            )}
        >
            <header className="flex shrink-0 items-center justify-between px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        className={cn(
                            'size-2 shrink-0 rounded-full',
                            // The synthetic "No status" column has no catalog colour.
                            !status.color && 'bg-neutral-400'
                        )}
                        // Status colour is arbitrary user-picked hex — no token equivalent.
                        style={status.color ? { backgroundColor: status.color } : undefined}
                    />
                    <span className="truncate text-sm font-semibold text-neutral-700">
                        {status.label}
                    </span>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-neutral-500">
                        {headerCount}
                    </span>
                </div>
                <MyDropdown
                    dropdownList={(Object.keys(SORT_LABELS) as BoardColumnSort[]).map((key) => ({
                        label: SORT_LABELS[key],
                        value: key,
                    }))}
                    onSelect={(value) => onSortChange(value as BoardColumnSort)}
                >
                    <button
                        type="button"
                        className={cn(
                            'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-neutral-500 hover:bg-white hover:text-neutral-700',
                            sort !== 'RECENT' && 'text-primary-600'
                        )}
                        title={`Sorted by ${SORT_LABELS[sort]}`}
                    >
                        <ArrowsDownUp className="size-3.5" />
                    </button>
                </MyDropdown>
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-32 w-full rounded-lg" />
                    ))
                ) : isError ? (
                    <p className="px-1 py-6 text-center text-xs text-danger-500">Failed to load.</p>
                ) : vms.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-neutral-400">No leads here.</p>
                ) : (
                    vms.map((vm) => (
                        <DraggableLeadCard
                            key={vm.key}
                            vm={vm}
                            columnKey={status.status_key}
                            dimmed={activeDragKey === vm.key}
                        >
                            <LeadCard
                                vm={vm}
                                profile={vm.userId ? profiles[vm.userId] : undefined}
                                showScore={showScore}
                                showOps={showOps}
                                actions={actions}
                            />
                        </DraggableLeadCard>
                    ))
                )}

                {hasNextPage && (
                    <div
                        ref={sentinelRef}
                        className="flex items-center justify-center gap-1.5 py-2"
                    >
                        {totalElements != null && (
                            <span className="text-xs text-neutral-400">
                                {tPages('leadBoard.scrollMore', {
                                    left: Math.max(0, totalElements - vms.length),
                                })}
                            </span>
                        )}
                        <CircleNotch
                            className={cn(
                                'size-4 text-neutral-400',
                                isFetchingNextPage && 'animate-spin'
                            )}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
