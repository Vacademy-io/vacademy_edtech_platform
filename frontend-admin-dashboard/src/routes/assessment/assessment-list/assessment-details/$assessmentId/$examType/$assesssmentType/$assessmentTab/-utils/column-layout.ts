import { orderColumnIds } from '@/components/shared/leads/use-lead-column-prefs';

/**
 * Applying a "Manage Column" layout to the submissions table.
 *
 * Kept out of AssessmentSubmissionsTab (which is `@ts-nocheck`'d, so nothing in it is
 * typechecked) and unit-tested, because getting this wrong moves columns to places the
 * user never asked for — and the row menu is `sticky right-0`, so it looks broken rather
 * than merely misplaced when it lands mid-table.
 */

/** Anything with a TanStack column identity, however it was declared. */
export interface ColumnLike {
    id?: string;
    accessorKey?: string;
}

/** A column's identity, whether it was declared with `id` or `accessorKey`. */
export const columnIdOf = (column: ColumnLike): string => column.id ?? column.accessorKey ?? '';

/**
 * Structural cells: the select box and the open-detail arrow, then the row menu. They have
 * no header to name in the popover and nothing meaningful to toggle, so they are never
 * listed there — and therefore never appear in a saved order either.
 */
export const LEADING_STRUCTURAL_COLUMN_IDS = ['checkbox', 'details'];
export const TRAILING_STRUCTURAL_COLUMN_IDS = ['options'];
export const STRUCTURAL_COLUMN_IDS = new Set([
    ...LEADING_STRUCTURAL_COLUMN_IDS,
    ...TRAILING_STRUCTURAL_COLUMN_IDS,
]);

/** Listed, ticked and disabled: a submissions row you can't put a name to is useless. */
export const LOCKED_COLUMN_IDS = new Set(['full_name']);

/** The ids the popover offers, in natural order — structural cells excluded. */
export const toggleableColumnIds = (columns: ColumnLike[]): string[] =>
    columns.map(columnIdOf).filter((id) => id !== '' && !STRUCTURAL_COLUMN_IDS.has(id));

/**
 * The columns to render, given what the user hid and how they ordered things.
 *
 * The structural cells are pinned to the ends rather than run through `orderColumnIds`.
 * That helper anchors a column it has never seen to whichever *saved* column naturally
 * precedes it — so the row menu, whose natural predecessor is the last data column, gets
 * dragged along the moment someone moves that column earlier. Ordering only the columns
 * the popover actually controls, then re-attaching the ends, keeps the select box and
 * detail arrow first and the row menu last no matter what the saved order says.
 */
export const applyColumnLayout = <T extends ColumnLike>(
    columns: T[],
    hiddenColumns: Set<string>,
    columnOrder: string[]
): T[] => {
    const shown = columns.filter((column) => {
        const id = columnIdOf(column);
        return (
            id === '' ||
            STRUCTURAL_COLUMN_IDS.has(id) ||
            LOCKED_COLUMN_IDS.has(id) ||
            !hiddenColumns.has(id)
        );
    });

    if (columnOrder.length === 0) return shown;

    const leading = shown.filter((c) => LEADING_STRUCTURAL_COLUMN_IDS.includes(columnIdOf(c)));
    const trailing = shown.filter((c) => TRAILING_STRUCTURAL_COLUMN_IDS.includes(columnIdOf(c)));
    const middle = shown.filter((c) => !STRUCTURAL_COLUMN_IDS.has(columnIdOf(c)));

    const byId = new Map(middle.map((c) => [columnIdOf(c), c]));
    const ordered = orderColumnIds([...byId.keys()], columnOrder)
        .map((id) => byId.get(id))
        .filter((c): c is T => !!c);

    return [...leading, ...ordered, ...trailing];
};
