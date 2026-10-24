import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CheckCircle, UserCircleMinus } from '@phosphor-icons/react';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { cn } from '@/lib/utils';
import { getInitials } from '../inbox/utils';
import { BoardColumnDef } from './board-model';

/** Draggable id must be unique per DndContext — the same doubt can sit in two staff columns. */
export const cardDragId = (columnKey: string, doubtId: string) => `${columnKey}::${doubtId}`;

/**
 * Draggable wrapper — the whole card is the handle; a plain click still opens the doubt
 * because the board's PointerSensor needs ~8px of travel before a drag activates.
 */
function DraggableDoubtCard({
    doubt,
    columnKey,
    disabled,
    dimmed,
    children,
}: {
    doubt: Doubt;
    columnKey: string;
    disabled: boolean;
    dimmed: boolean;
    children: ReactNode;
}) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: cardDragId(columnKey, doubt.id),
        data: { doubt, fromKey: columnKey },
        disabled,
    });
    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            className={cn(
                !disabled && 'cursor-grab active:cursor-grabbing',
                (isDragging || dimmed) && 'opacity-40'
            )}
        >
            {children}
        </div>
    );
}

/**
 * One column of the doubt board: header (who / how many) + its cards. Acts as the dnd-kit
 * drop target keyed by the column key (a user id, or the synthetic Unassigned / Resolved).
 */
export const DoubtBoardColumn = ({
    column,
    doubts,
    canDrag,
    activeDoubtId,
    pendingDoubtIds,
    renderCard,
}: {
    column: BoardColumnDef;
    doubts: Doubt[];
    canDrag: boolean;
    /** Id of the doubt being dragged — its in-place copies are dimmed. */
    activeDoubtId: string | null;
    /** Doubts with a save in flight — shown in their new column but not draggable again yet. */
    pendingDoubtIds: ReadonlySet<string>;
    renderCard: (doubt: Doubt) => ReactNode;
}) => {
    const { t } = useTranslation('studyLibraryDoubtBoard');
    const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: !canDrag });

    const dropHint =
        column.kind === 'staff'
            ? t('dropToAssign', { name: column.name })
            : column.kind === 'status'
              ? t('dropToStatus', { name: column.name })
              : column.kind === 'resolved'
                ? t('dropToResolve')
                : t('dropToUnassign');

    return (
        <section
            ref={setNodeRef}
            aria-label={column.name}
            className={cn(
                'flex h-full w-72 shrink-0 flex-col rounded-xl border transition-colors',
                column.kind === 'resolved' ? 'bg-success-50/40' : 'bg-neutral-50/60',
                isOver ? 'border-primary-400 bg-primary-50/60' : 'border-neutral-200'
            )}
        >
            <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
                {column.kind === 'staff' ? (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-caption font-semibold text-primary-700">
                        {getInitials(column.name)}
                    </span>
                ) : column.kind === 'status' ? (
                    <span
                        aria-hidden
                        className={cn(
                            'size-2.5 shrink-0 rounded-full',
                            !column.color && 'bg-neutral-400'
                        )}
                        style={column.color ? { backgroundColor: column.color } : undefined} // design-lint-ignore: admin-picked status colour has no token
                    />
                ) : column.kind === 'resolved' ? (
                    <CheckCircle
                        size={20}
                        weight="duotone"
                        className="shrink-0 text-success-600"
                        aria-hidden
                    />
                ) : (
                    <UserCircleMinus
                        size={20}
                        weight="duotone"
                        className="shrink-0 text-neutral-400"
                        aria-hidden
                    />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-neutral-700">
                        {column.name}
                    </span>
                    {column.subtitle && (
                        <span className="truncate text-caption text-neutral-400">
                            {column.subtitle}
                        </span>
                    )}
                </div>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-neutral-500">
                    {doubts.length}
                </span>
            </header>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {doubts.length === 0 ? (
                    <p
                        className={cn(
                            'rounded-lg border border-dashed px-3 py-6 text-center text-xs',
                            isOver
                                ? 'border-primary-300 text-primary-600'
                                : 'border-neutral-200 text-neutral-400'
                        )}
                    >
                        {canDrag ? dropHint : t('emptyColumn')}
                    </p>
                ) : (
                    doubts.map((doubt) => (
                        <DraggableDoubtCard
                            key={doubt.id}
                            doubt={doubt}
                            columnKey={column.key}
                            disabled={!canDrag || pendingDoubtIds.has(doubt.id)}
                            dimmed={activeDoubtId === doubt.id}
                        >
                            {renderCard(doubt)}
                        </DraggableDoubtCard>
                    ))
                )}
            </div>
        </section>
    );
};
