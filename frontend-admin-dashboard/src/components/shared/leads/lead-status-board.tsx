import { useMemo, useState } from 'react';
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
import { cn } from '@/lib/utils';
import { NO_STATUS_KEY, setLeadStatusForLead, type LeadStatus } from '@/hooks/use-lead-statuses';
import type { LeadCardVM } from './lead-view-model';
import type { LeadActionHandlers } from './lead-actions';
import { LeadCard } from './lead-card';
import { LeadStatusBoardColumn, type BoardColumnSort } from './lead-status-board-column';
import { useAdmissionCourseGuard } from './admission-course-guard';
import { serverRefusal } from './services/admission-check';

/**
 * LeadStatusBoard — the drag-and-drop Kanban over the institute's lead-status
 * catalog. One LeadStatusBoardColumn per (visible) status; dropping a card on
 * another column persists the change through the same endpoint as the inline
 * status chip (setLeadStatusForLead) with an optimistic move: the card jumps
 * immediately, and snaps back with an error toast if the save fails.
 */

interface BoardPage {
    content: unknown[];
    last: boolean;
    totalElements: number;
}

/** One in-flight optimistic move: hide in `fromKey`, show on top of `toKey`. */
interface PendingMove {
    vm: LeadCardVM;
    fromKey: string;
    toKey: string;
}

interface LeadStatusBoardProps {
    /** Visible statuses, already ordered/filtered by the caller's column picker. */
    statuses: LeadStatus[];
    fetchFn: (payload: Record<string, unknown>) => Promise<BoardPage>;
    /** Scope + shared filters; NOT status/sort/page/size. */
    basePayload: Record<string, unknown>;
    surfaceId: string;
    scopeId: string;
    showScore: boolean;
    showOps: boolean;
    toVM: (raw: unknown) => LeadCardVM;
    actions: LeadActionHandlers;
    /** Called after a successful status change so the caller can refresh siblings. */
    onStatusChanged?: () => void;
    className?: string;
}

export function LeadStatusBoard({
    statuses,
    fetchFn,
    basePayload,
    surfaceId,
    scopeId,
    showScore,
    showOps,
    toVM,
    actions,
    onStatusChanged,
    className,
}: LeadStatusBoardProps) {
    const queryClient = useQueryClient();

    // ~8px of movement before a drag starts, so plain clicks still open the
    // lead side view / card actions.
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

    const [activeDrag, setActiveDrag] = useState<LeadCardVM | null>(null);
    const [pendingMoves, setPendingMoves] = useState<Map<string, PendingMove>>(new Map());
    // Per-column sort, keyed by status_key. Defaults to newest-first.
    const [columnSorts, setColumnSorts] = useState<Record<string, BoardColumnSort>>({});
    const { confirmAdmission, admissionDialog } = useAdmissionCourseGuard();

    const handleDragStart = (event: DragStartEvent) => {
        const data = event.active.data.current as { vm?: LeadCardVM } | undefined;
        setActiveDrag(data?.vm ?? null);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        setActiveDrag(null);
        const { active, over } = event;
        const data = active.data.current as { vm: LeadCardVM; fromKey: string } | undefined;
        if (!over || !data) return;
        const toKey = String(over.id);
        if (toKey === data.fromKey) return;
        const target = statuses.find((s) => s.status_key === toKey);
        if (!target) return;
        // The synthetic "No status" column has no catalog row to assign — its
        // droppable is disabled, but guard here too in case a drop slips through.
        if (target.status_key === NO_STATUS_KEY) return;
        if (!data.vm.responseId) {
            toast.error('This lead has no submission id, so its status can’t be changed');
            return;
        }

        // A drop on the admission status for someone with no course or fee plan asks first
        // (or explains why it can't), when the institute has that rule switched on.
        if (!(await confirmAdmission([data.vm.responseId], target))) return;

        const cardKey = data.vm.key;
        setPendingMoves((prev) =>
            new Map(prev).set(cardKey, { vm: data.vm, fromKey: data.fromKey, toKey })
        );

        setLeadStatusForLead(data.vm.responseId, target.id, 'MANUAL')
            .then(async () => {
                toast.success(`${data.vm.name} moved to ${target.label}`);
                // Refetch every column of this board (counts + membership), and
                // let the surface refresh its siblings (table/profile caches).
                await queryClient.invalidateQueries({ queryKey: ['lead-board', surfaceId] });
                onStatusChanged?.();
            })
            .catch((error) => {
                toast.error(serverRefusal(error) ?? 'Failed to move lead — change reverted');
            })
            .finally(() => {
                // Success: the refetched columns already contain the card in its
                // new home. Failure: removing the entry snaps the card back.
                setPendingMoves((prev) => {
                    const next = new Map(prev);
                    next.delete(cardKey);
                    return next;
                });
            });
    };

    const moves = useMemo(() => Array.from(pendingMoves.values()), [pendingMoves]);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveDrag(null)}
        >
            <div className={cn('flex h-full gap-3 overflow-x-auto pb-2', className)}>
                {statuses.map((status) => (
                    <LeadStatusBoardColumn
                        key={status.id}
                        status={status}
                        fetchFn={fetchFn}
                        basePayload={basePayload}
                        surfaceId={surfaceId}
                        scopeId={scopeId}
                        sort={columnSorts[status.status_key] ?? 'RECENT'}
                        onSortChange={(sort) =>
                            setColumnSorts((prev) => ({ ...prev, [status.status_key]: sort }))
                        }
                        showScore={showScore}
                        showOps={showOps}
                        toVM={toVM}
                        actions={actions}
                        pendingIn={moves
                            .filter((m) => m.toKey === status.status_key)
                            .map((m) => m.vm)}
                        pendingOutKeys={
                            new Set(
                                moves
                                    .filter((m) => m.fromKey === status.status_key)
                                    .map((m) => m.vm.key)
                            )
                        }
                        activeDragKey={activeDrag?.key ?? null}
                    />
                ))}
            </div>

            <DragOverlay dropAnimation={null}>
                {activeDrag ? (
                    <div className="w-64 rotate-2 opacity-95 shadow-lg">
                        <LeadCard
                            vm={activeDrag}
                            profile={undefined}
                            showScore={false}
                            showOps={showOps}
                            actions={actions}
                        />
                    </div>
                ) : null}
            </DragOverlay>
            {admissionDialog}
        </DndContext>
    );
}
