import type { ReactNode } from 'react';
import { Columns, DotsSixVertical } from '@phosphor-icons/react';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { LeadColumnToggle } from './use-lead-column-prefs';

interface ManageColumnsPopoverProps {
    /** Toggleable columns, in display order (see buildLeadColumnToggles). */
    columns: LeadColumnToggle[];
    /** Currently hidden column ids. A ticked checkbox means the column is visible. */
    hiddenColumns: Set<string>;
    onToggle: (id: string) => void;
    /** When provided, shows a "Reset" affordance while any column is hidden. */
    onReset?: () => void;
    /**
     * When provided, rows become draggable and dropping one reports the full new id order
     * (every column in `columns`, including locked ones — they move, they just can't hide).
     * Omit to keep the plain checkbox list.
     */
    onReorder?: (orderedIds: string[]) => void;
    /**
     * Render the trigger as an icon-only button. For toolbars that are already at their
     * width budget — the assessment submissions table sits behind a search box, four
     * filters and three export actions on one row. Off by default, so every existing
     * call site keeps the labelled button.
     */
    compact?: boolean;
}

/** Grip + visibility checkbox + label. Layout is shared by the plain and draggable rows. */
function ColumnRowBody({
    column,
    hidden,
    onToggle,
    handle,
}: {
    column: LeadColumnToggle;
    hidden: boolean;
    onToggle: (id: string) => void;
    handle?: ReactNode;
}) {
    return (
        <>
            {handle}
            <label
                className={cn(
                    'flex min-w-0 flex-1 items-center gap-2',
                    column.locked ? 'cursor-default' : 'cursor-pointer'
                )}
            >
                <Checkbox
                    checked={column.locked ? true : !hidden}
                    disabled={column.locked}
                    onCheckedChange={() => !column.locked && onToggle(column.id)}
                />
                <span className="truncate">{column.label}</span>
            </label>
            {column.locked && <span className="shrink-0 text-2xs text-neutral-400">Always</span>}
        </>
    );
}

const ROW_CSS =
    'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-neutral-700 hover:bg-neutral-50';

/** One draggable row. Only rendered when reordering is enabled, so `useSortable` always
 *  has a real DndContext above it. */
function SortableColumnRow({
    column,
    hidden,
    onToggle,
}: {
    column: LeadColumnToggle;
    hidden: boolean;
    onToggle: (id: string) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: column.id,
    });

    return (
        <div
            ref={setNodeRef}
            // design-lint-ignore: drag transform/transition are computed per-frame by dnd-kit —
            // there is no token for a live pointer offset.
            style={{
                transform: CSS.Translate.toString(transform),
                transition,
                opacity: isDragging ? 0.6 : 1,
            }}
            className={cn(ROW_CSS, isDragging && 'bg-neutral-50 shadow-sm')}
        >
            <ColumnRowBody
                column={column}
                hidden={hidden}
                onToggle={onToggle}
                handle={
                    <button
                        type="button"
                        // The grip is the drag handle rather than the whole row, so clicking a
                        // label still toggles the column instead of starting a drag.
                        className="cursor-grab touch-none text-neutral-400 hover:text-neutral-600 active:cursor-grabbing"
                        aria-label={`Reorder ${column.label}`}
                        {...attributes}
                        {...listeners}
                    >
                        <DotsSixVertical size={14} weight="bold" />
                    </button>
                }
            />
        </div>
    );
}

/**
 * "Manage Column" popover for a table — a checkbox per column (ticked = visible), and,
 * when `onReorder` is supplied, a grip handle to drag columns into the order you want.
 * Selection and order are owned by the caller (see useLeadColumnPrefs /
 * useColumnOrderPrefs) so they can be persisted per surface. Shared by the Recent Leads
 * page, the audience lead list and Manage Payments so they all behave identically.
 */
export function ManageColumnsPopover({
    columns,
    hiddenColumns,
    onToggle,
    onReset,
    onReorder,
    compact = false,
}: ManageColumnsPopoverProps) {
    const anyHidden = columns.some((c) => hiddenColumns.has(c.id));
    // 8px of travel before a drag starts, so a click on the grip isn't swallowed.
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const ids = columns.map((c) => c.id);
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        onReorder?.(arrayMove(ids, from, to));
    };

    const rows = (
        <div className="space-y-1">
            {columns.map((c) =>
                onReorder ? (
                    <SortableColumnRow
                        key={c.id}
                        column={c}
                        hidden={hiddenColumns.has(c.id)}
                        onToggle={onToggle}
                    />
                ) : (
                    <label key={c.id} className={ROW_CSS}>
                        <Checkbox
                            checked={c.locked ? true : !hiddenColumns.has(c.id)}
                            disabled={c.locked}
                            onCheckedChange={() => !c.locked && onToggle(c.id)}
                        />
                        {c.label}
                    </label>
                )
            )}
        </div>
    );

    return (
        <Popover>
            <Tooltip>
                <PopoverTrigger asChild>
                    <TooltipTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-10"
                            aria-label="Manage Column"
                        >
                            <Columns className="mr-1.5 size-4" />
                            {compact ? 'Columns' : 'Manage Column'}
                        </Button>
                    </TooltipTrigger>
                </PopoverTrigger>
                <TooltipContent side="bottom">
                    Choose which columns are shown, and drag to reorder them
                </TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className={onReorder ? 'w-64' : 'w-52'}>
                <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Columns
                    </p>
                    {onReset && (anyHidden || onReorder) && (
                        <button
                            type="button"
                            onClick={onReset}
                            className="text-xs font-medium text-primary-600 hover:underline"
                        >
                            Reset
                        </button>
                    )}
                </div>
                {onReorder && (
                    <p className="mb-2 text-2xs text-neutral-400">
                        Drag the handle to reorder columns.
                    </p>
                )}
                {onReorder ? (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={columns.map((c) => c.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            {rows}
                        </SortableContext>
                    </DndContext>
                ) : (
                    rows
                )}
            </PopoverContent>
        </Popover>
    );
}
