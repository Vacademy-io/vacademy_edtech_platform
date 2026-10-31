import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    pointerWithin,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import { Plus } from '@phosphor-icons/react';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { useInstituteAssignees } from '@/routes/dashboard/-hooks/useInstituteAssignees';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useGetUserBasicDetails } from '@/services/get_user_basic_details';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { MyButton } from '@/components/design-system/button';
import { isUserAdmin } from '@/utils/userDetails';
import { getInstituteId } from '@/constants/helper';
import { cn, convertCapitalToTitleCase } from '@/lib/utils';
import { useDoubtBoard } from '../../-hooks/useDoubtBoard';
import { useDoubtBoardColumnPrefs } from '../../-hooks/useDoubtBoardColumnPrefs';
import { updateDoubtAssignment } from '../../-services/update-doubt-assignment';
import { DOUBT_ACTIVITY_QUERY_KEY } from '../../-services/use-doubt-activity';
import { useDoubtStatuses } from '../../-services/use-doubt-statuses';
import { useDoubtView } from '../../-stores/view-store';
import { ConversationPane } from '../inbox/conversation-pane';
import {
    applyPatchLocally,
    BoardColumnDef,
    DoubtAssignmentPatch,
    groupDoubtsByColumn,
    groupDoubtsByStatus,
    isSyntheticKey,
    MoveOutcome,
    planMove,
    planStatusMove,
    RESOLVED_KEY,
    UNASSIGNED_KEY,
} from './board-model';
import { BoardGroupByToggle } from './board-group-by-toggle';
import { AddStatusDialog } from '../status/add-status-dialog';
import { BoardColumnsPopover, BoardStaffOption } from './board-columns-popover';
import { DoubtBoardColumn } from './doubt-board-column';
import { DoubtBoardCard } from './doubt-board-card';

/** One in-flight optimistic move: the doubt is rendered as if `patch` were already saved. */
interface PendingMove {
    doubt: Doubt;
    patch: DoubtAssignmentPatch;
}

/**
 * Jira-style Kanban over the filtered doubt list. Two layouts, switchable in the toolbar:
 *  - by assignee: Unassigned | one column per teacher | Resolved — dragging assigns / reassigns /
 *    unassigns / resolves / reopens;
 *  - by status: one column per configurable workflow status — dragging moves the doubt to that
 *    status (recorded in its activity trail; a remark can be added from the toast).
 * Both go through the same endpoint as the inbox controls, with an optimistic move (the card
 * jumps immediately and snaps back with a toast if the save fails). Clicking a card opens the
 * full conversation in a side sheet so replies, status remarks and manual assignment stay one
 * click away.
 */
export const DoubtBoard = () => {
    const { t } = useTranslation('studyLibraryDoubtBoard');
    const queryClient = useQueryClient();
    const isAdmin = isUserAdmin();
    const instituteId = getInstituteId();
    const {
        doubts,
        totalElements,
        isLoading,
        error,
        refetch,
        fetchNextPage,
        hasNextPage,
        userDetailsRecord,
    } = useDoubtBoard();
    const { assignees } = useInstituteAssignees(instituteId);
    const { instituteDetails } = useInstituteDetailsStore();
    const prefs = useDoubtBoardColumnPrefs(`doubt-board-columns:${instituteId ?? ''}`);
    const { boardGroupBy: groupBy, setBoardGroupBy: setGroupBy } = useDoubtView();
    const { enabledStatuses, byKey: statusByKey, labelByKey: statusLabel } = useDoubtStatuses();

    // ~8px of movement before a drag starts, so a plain click still opens the doubt.
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
    const [activeDrag, setActiveDrag] = useState<Doubt | null>(null);
    const [pendingMoves, setPendingMoves] = useState<Map<string, PendingMove>>(new Map());

    // Cards render from the optimistically patched doubts, so an in-flight move lands in its new
    // column through the ordinary grouping — no per-column pendingIn/pendingOut bookkeeping.
    const effectiveDoubts = useMemo(
        () =>
            doubts.map((doubt) => {
                const pending = pendingMoves.get(doubt.id);
                return pending ? applyPatchLocally(doubt, pending.patch) : doubt;
            }),
        [doubts, pendingMoves]
    );
    // Assignee grouping always runs (it also feeds the Columns picker counts); status grouping
    // only when that layout is active.
    const groups = useMemo(() => groupDoubtsByColumn(effectiveDoubts), [effectiveDoubts]);
    const statusGroups = useMemo(
        () => (groupBy === 'status' ? groupDoubtsByStatus(effectiveDoubts, enabledStatuses) : null),
        [groupBy, effectiveDoubts, enabledStatuses]
    );
    const pendingDoubtIds = useMemo(() => new Set(pendingMoves.keys()), [pendingMoves]);

    // Staff = the institute's assignable users, plus anyone who holds an assignment but isn't in
    // that list any more (deactivated / other role) so their cards still have a home column.
    const staffById = useMemo(() => {
        const map = new Map<string, { id: string; name: string; subtitle?: string }>();
        assignees.forEach((a) => map.set(a.id, { id: a.id, name: a.name, subtitle: a.subtitle }));
        return map;
    }, [assignees]);
    const unknownAssigneeIds = useMemo(
        () => [...groups.keys()].filter((key) => !isSyntheticKey(key) && !staffById.has(key)),
        [groups, staffById]
    );
    const { data: unknownAssigneeDetails } = useGetUserBasicDetails(unknownAssigneeIds);
    const assigneeNameById = useCallback(
        (id: string) =>
            staffById.get(id)?.name ??
            unknownAssigneeDetails?.find((u) => u.id === id)?.name ??
            t('unknownStaff'),
        [staffById, unknownAssigneeDetails, t]
    );

    const staffOptions = useMemo<BoardStaffOption[]>(() => {
        const ids = new Set<string>([...staffById.keys(), ...unknownAssigneeIds]);
        const options = [...ids].map((id) => {
            const count = groups.get(id)?.length ?? 0;
            return {
                id,
                name: assigneeNameById(id),
                subtitle: staffById.get(id)?.subtitle,
                count,
                visible: prefs.isColumnVisible(id, count > 0),
            };
        });
        options.sort((a, b) => a.name.localeCompare(b.name));
        return options;
    }, [staffById, unknownAssigneeIds, groups, assigneeNameById, prefs]);

    const columns = useMemo<BoardColumnDef[]>(() => {
        if (statusGroups) {
            // Catalog order; a doubt sitting on a status that was since disabled/removed still
            // gets a column so it never silently disappears from the board.
            return [...statusGroups.keys()].map<BoardColumnDef>((key) => {
                const cfg = statusByKey(key);
                return {
                    key,
                    kind: 'status',
                    name: cfg?.label ?? statusLabel(key),
                    color: cfg?.color,
                };
            });
        }
        return [
            { key: UNASSIGNED_KEY, kind: 'unassigned', name: t('unassigned') },
            ...staffOptions
                .filter((s) => s.visible)
                .map<BoardColumnDef>((s) => ({
                    key: s.id,
                    kind: 'staff',
                    name: s.name,
                    subtitle: s.subtitle,
                })),
            { key: RESOLVED_KEY, kind: 'resolved', name: t('resolved') },
        ];
    }, [statusGroups, statusByKey, statusLabel, staffOptions, t]);
    const activeGroups = statusGroups ?? groups;

    const batchNameFor = useCallback(
        (doubt: Doubt) => {
            const batch = instituteDetails?.batches_for_sessions?.find(
                (b) => b.id === doubt.batch_id
            );
            return batch
                ? `${convertCapitalToTitleCase(batch.level.level_name)} ${convertCapitalToTitleCase(
                      batch.package_dto.package_name
                  )} ${convertCapitalToTitleCase(batch.session.session_name)}`
                : '';
        },
        [instituteDetails?.batches_for_sessions]
    );

    // Side sheet with the full conversation. Keep the last rendered doubt so the sheet doesn't
    // blank out mid-read when a refetch drops the doubt from the filtered list (e.g. it was
    // just resolved while the Status filter is "Pending").
    const [openDoubtId, setOpenDoubtId] = useState<string | null>(null);
    // Open the sheet with the activity trail expanded (toast → "Add remark").
    const [openActivity, setOpenActivity] = useState(false);
    const [addStatusOpen, setAddStatusOpen] = useState(false);
    const lastOpenDoubtRef = useRef<Doubt | null>(null);
    const openDoubt = openDoubtId
        ? doubts.find((d) => d.id === openDoubtId) ?? lastOpenDoubtRef.current
        : null;
    if (openDoubt) lastOpenDoubtRef.current = openDoubt;

    const outcomeMessage = (outcome: MoveOutcome, fromKey: string, toKey: string) => {
        switch (outcome) {
            case 'assigned':
                return t('toast.assigned', { name: assigneeNameById(toKey) });
            case 'reassigned':
                return t('toast.reassigned', {
                    from: assigneeNameById(fromKey),
                    to: assigneeNameById(toKey),
                });
            case 'unassigned':
                return t('toast.unassigned', { name: assigneeNameById(fromKey) });
            case 'resolved':
                return t('toast.resolved');
            case 'reopened':
                return t('toast.reopened');
            case 'reopenedAssigned':
                return t('toast.reopenedAssigned', { name: assigneeNameById(toKey) });
            case 'statusChanged':
                return t('toast.statusChanged', { label: statusLabel(toKey) });
        }
    };

    const handleDragStart = (event: DragStartEvent) => {
        const data = event.active.data.current as { doubt?: Doubt } | undefined;
        setActiveDrag(data?.doubt ?? null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveDrag(null);
        const { active, over } = event;
        const data = active.data.current as { doubt: Doubt; fromKey: string } | undefined;
        if (!over || !data) return;
        const toKey = String(over.id);
        const plan = statusGroups
            ? planStatusMove(data.fromKey, toKey)
            : planMove(data.fromKey, toKey);
        if (!plan) return;
        if (plan.patch.workflowStatus) {
            // Kind-derived coarse status so the optimistic card and the Resolved semantics agree.
            const target = statusByKey(plan.patch.workflowStatus);
            if (target) plan.patch.status = target.kind === 'RESOLVED' ? 'RESOLVED' : 'ACTIVE';
        }
        // Always build the payload from the server copy: the rendered card may already carry
        // placeholder assignee rows from an earlier optimistic patch.
        const original = doubts.find((d) => d.id === data.doubt.id);
        if (!original || pendingMoves.has(original.id)) return;

        setPendingMoves((prev) =>
            new Map(prev).set(original.id, { doubt: original, patch: plan.patch })
        );
        updateDoubtAssignment(original, plan.patch)
            .then(async () => {
                toast.success(outcomeMessage(plan.outcome, data.fromKey, toKey), {
                    // A status move is the moment to note WHY — jump straight to the trail.
                    action:
                        plan.outcome === 'statusChanged'
                            ? {
                                  label: t('toast.addRemark'),
                                  onClick: () => {
                                      setOpenActivity(true);
                                      setOpenDoubtId(original.id);
                                  },
                              }
                            : undefined,
                });
                // Wait for the board (and inbox) to refetch before dropping the optimistic entry,
                // so the card never flickers back to its old column in between.
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['GET_DOUBTS'] }),
                    queryClient.invalidateQueries({
                        queryKey: [DOUBT_ACTIVITY_QUERY_KEY, original.id],
                    }),
                ]);
            })
            .catch(() => {
                toast.error(t('toast.moveFailed'));
            })
            .finally(() => {
                setPendingMoves((prev) => {
                    const next = new Map(prev);
                    next.delete(original.id);
                    return next;
                });
            });
    };

    const renderCard = (doubt: Doubt) => (
        <DoubtBoardCard
            doubt={doubt}
            learnerName={userDetailsRecord[doubt.user_id]?.name}
            batchName={batchNameFor(doubt)}
            assigneeNameById={assigneeNameById}
            onOpen={() => setOpenDoubtId(doubt.id)}
        />
    );

    return (
        <div
            className={cn(
                'flex min-h-0 flex-col gap-3 overflow-hidden rounded-xl border border-neutral-200 bg-white p-3 shadow-sm',
                'h-[calc(100dvh-13rem)]' // design-lint-ignore: viewport-relative board height has no spacing token
            )}
        >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-neutral-500">
                    {isLoading
                        ? t('loading')
                        : t('showingCount', { shown: doubts.length, total: totalElements })}
                    {isAdmin && !isLoading && (
                        <span className="text-neutral-400"> · {t('dragHint')}</span>
                    )}
                </p>
                <div className="flex items-center gap-2">
                    <BoardGroupByToggle value={groupBy} onChange={setGroupBy} />
                    {!statusGroups && (
                        <BoardColumnsPopover
                            staff={staffOptions}
                            onToggle={prefs.setColumnVisible}
                            onReset={prefs.resetColumns}
                            canReset={prefs.hasOverrides}
                        />
                    )}
                </div>
            </div>
            {error ? (
                <p className="p-6 text-center text-sm text-danger-600">{t('failedToLoad')}</p>
            ) : isLoading ? (
                <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div
                            key={i}
                            className="h-full w-72 shrink-0 animate-pulse rounded-xl bg-neutral-100"
                        />
                    ))}
                </div>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={pointerWithin}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragCancel={() => setActiveDrag(null)}
                >
                    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
                        {columns.map((column) => (
                            <DoubtBoardColumn
                                key={column.key}
                                column={column}
                                doubts={activeGroups.get(column.key) ?? []}
                                canDrag={isAdmin}
                                activeDoubtId={activeDrag?.id ?? null}
                                pendingDoubtIds={pendingDoubtIds}
                                renderCard={renderCard}
                            />
                        ))}
                        {statusGroups && isAdmin && (
                            // Jira-style "create column": a new custom status, saved to the
                            // institute's Doubt Management setting, appears as a column right away.
                            <button
                                type="button"
                                onClick={() => setAddStatusOpen(true)}
                                className="flex h-full w-56 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50/40 text-sm font-medium text-neutral-500 transition-colors hover:border-primary-300 hover:bg-primary-50/40 hover:text-primary-600"
                            >
                                <Plus size={20} weight="bold" aria-hidden />
                                {t('addStatusColumn')}
                            </button>
                        )}
                    </div>
                    <DragOverlay dropAnimation={null}>
                        {activeDrag ? (
                            <div className="w-64 rotate-2 opacity-95 shadow-lg">
                                {renderCard(activeDrag)}
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            )}
            {hasNextPage && !isLoading && !error && (
                <div className="flex shrink-0 justify-center">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onAsyncClick={async () => {
                            await fetchNextPage();
                        }}
                        loadingText={t('loading')}
                    >
                        {t('loadMore')}
                    </MyButton>
                </div>
            )}
            <AddStatusDialog open={addStatusOpen} onOpenChange={setAddStatusOpen} />

            <Sheet
                open={!!openDoubt}
                onOpenChange={(open) => {
                    if (!open) {
                        setOpenDoubtId(null);
                        setOpenActivity(false);
                    }
                }}
            >
                <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
                    <SheetHeader className="shrink-0 border-b border-neutral-200 px-4 py-3 pr-12 text-left">
                        <SheetTitle className="text-sm font-semibold text-neutral-700">
                            {t('doubtDetails')}
                        </SheetTitle>
                        <SheetDescription className="sr-only">
                            {t('doubtDetailsDescription')}
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1">
                        {openDoubt && (
                            <ConversationPane
                                doubt={openDoubt}
                                refetch={() => void refetch()}
                                learnerName={userDetailsRecord[openDoubt.user_id]?.name}
                                onBack={() => setOpenDoubtId(null)}
                                activityDefaultOpen={openActivity}
                            />
                        )}
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
};
