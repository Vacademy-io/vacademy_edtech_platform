import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowsHorizontal, CaretDown, CaretUp, CaretUpDown } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyTable } from '@/components/design-system/table';
import { staticTableData } from '@/components/shared/crm-enhance/group-dashboard-shell';
import { cn } from '@/lib/utils';
import type { CellTone, ReportColumn, ReportTableSpec } from '../../-utils/report-tables';

const TONE_CLASS: Record<CellTone, string> = {
    danger: 'text-danger-600',
    warning: 'text-warning-700',
    success: 'text-success-700',
    muted: 'text-neutral-400',
};

/** Long tables show this many rows, with a button for the rest. */
const DEFAULT_MAX_ROWS = 10;

/** Narrower than the shared header cell's default 16px sides, so number columns can stay slim. */
const COLUMN_PADDING = 'px-2';

type SortState = { id: string; dir: 'asc' | 'desc' } | null;

/** The rows in the order shown; rows the spec pins (a "rest of the rows" total) stay last. */
function sortRows<R>(spec: ReportTableSpec<R>, sort: SortState): R[] {
    const pinned = spec.pinLast ? spec.rows.filter(spec.pinLast) : [];
    const rest = spec.pinLast ? spec.rows.filter((r) => !spec.pinLast?.(r)) : spec.rows;
    return [...sortRest(spec, rest, sort), ...pinned];
}

function sortRest<R>(spec: ReportTableSpec<R>, rows: R[], sort: SortState): R[] {
    const column = sort ? spec.columns.find((c) => c.id === sort.id) : undefined;
    const get = column?.sort;
    if (!sort || !get) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const x = get(a);
        const y = get(b);
        if (x === null && y === null) return spec.tieBreak?.(a, b) ?? 0;
        if (x === null) return 1; // no figure sorts last, whichever way it is sorted
        if (y === null) return -1;
        const order =
            typeof x === 'number' && typeof y === 'number'
                ? x - y
                : String(x).localeCompare(String(y));
        return order !== 0 ? order * dir : spec.tieBreak?.(a, b) ?? 0;
    });
}

function HeaderCell<R>({
    column,
    sort,
    onSort,
}: {
    column: ReportColumn<R>;
    sort: SortState;
    onSort: (id: string) => void;
}) {
    const { t } = useTranslation('engagementDailyReport');
    if (!column.sort) {
        return (
            <div className={cn('break-words', column.numeric && 'text-end')}>
                <span className="text-body font-semibold">{column.header}</span>
            </div>
        );
    }
    const active = !!sort && sort.id === column.id;
    const SortIcon = sort && active ? (sort.dir === 'asc' ? CaretUp : CaretDown) : CaretUpDown;
    return (
        <div className={cn('flex', column.numeric && 'justify-end')}>
            <button
                type="button"
                onClick={() => onSort(column.id)}
                aria-label={t('table.sortBy', { column: column.header })}
                className="inline-flex items-center gap-1 break-words rounded-sm text-start hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <span className="text-body font-semibold">{column.header}</span>
                <SortIcon size={12} weight={active ? 'bold' : 'regular'} className="shrink-0" />
            </button>
        </div>
    );
}

function BodyCell<R>({ column, row }: { column: ReportColumn<R>; row: R }) {
    const text = column.text(row);
    const tone = column.tone?.(row);
    return (
        <div className={cn(column.numeric && 'text-end tabular-nums', tone && TONE_CLASS[tone])}>
            <span
                title={text}
                className={column.wrap ? 'line-clamp-2 break-words' : 'block truncate'}
            >
                {column.render ? column.render(row) : text}
            </span>
        </div>
    );
}

/**
 * Whether the table's scroll area has more columns off to either side. MyTable scrolls
 * sideways inside its own box when it is wider than the card, and says nothing about it, so
 * this watches that box to let the table show a fade and a hint.
 */
function useSideScroll(root: React.RefObject<HTMLDivElement>, columnCount: number) {
    const [edges, setEdges] = useState({ before: false, after: false });
    useEffect(() => {
        const scroller = root.current?.querySelector<HTMLElement>('.overflow-auto');
        if (!scroller) return;
        const update = () => {
            const offset = Math.abs(scroller.scrollLeft);
            const next = {
                before: offset > 1,
                after: offset + scroller.clientWidth < scroller.scrollWidth - 1,
            };
            setEdges((prev) =>
                prev.before === next.before && prev.after === next.after ? prev : next
            );
        };
        update();
        scroller.addEventListener('scroll', update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(scroller);
        if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
        return () => {
            scroller.removeEventListener('scroll', update);
            observer.disconnect();
        };
    }, [root, columnCount]);
    return edges;
}

interface ReportTableProps<R> {
    spec: ReportTableSpec<R>;
    maxRows?: number;
    /** A line under each row (the Lead Agent figures under a list). */
    renderExpandedRow?: (row: R) => React.ReactNode | null;
}

/**
 * A report table: MyTable columns built from the shared spec, sortable where the spec
 * allows, long lists cut to `maxRows` with a "show all" button. The data is already
 * aggregated and small, so sorting is done here rather than on the server. When the columns
 * are wider than the card the table scrolls sideways, with a fade and a hint to say so.
 */
export function ReportTable<R>({
    spec,
    maxRows = DEFAULT_MAX_ROWS,
    renderExpandedRow,
}: ReportTableProps<R>) {
    const { t } = useTranslation('engagementDailyReport');
    const [sort, setSort] = useState<SortState>(spec.defaultSort ?? null);
    const [showAll, setShowAll] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    const rows = useMemo(() => sortRows(spec, sort), [spec, sort]);
    const visible = useMemo(() => {
        if (showAll || rows.length <= maxRows) return rows;
        // Pinned rows stay in view when the list is cut short.
        const pinned = spec.pinLast ? rows.filter(spec.pinLast) : [];
        const rest = spec.pinLast ? rows.filter((r) => !spec.pinLast?.(r)) : rows;
        return [...rest.slice(0, Math.max(maxRows - pinned.length, 1)), ...pinned];
    }, [rows, showAll, maxRows, spec]);

    const shownColumns = useMemo(() => spec.columns.filter((c) => !c.exportOnly), [spec.columns]);
    const columnWidths = useMemo(
        () => Object.fromEntries(shownColumns.map((c) => [c.id, COLUMN_PADDING])),
        [shownColumns]
    );
    const edges = useSideScroll(root, shownColumns.length);

    const columns = useMemo<ColumnDef<R>[]>(() => {
        const toggleSort = (id: string) =>
            setSort((prev) => {
                const numeric = spec.columns.find((c) => c.id === id)?.numeric;
                if (prev?.id === id) return { id, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
                return { id, dir: numeric ? 'desc' : 'asc' };
            });
        return shownColumns.map(
            (column): ColumnDef<R> => ({
                id: column.id,
                size: column.size ?? (column.numeric ? 96 : 200),
                header: () => <HeaderCell column={column} sort={sort} onSort={toggleSort} />,
                cell: ({ row }) => <BodyCell column={column} row={row.original} />,
            })
        );
    }, [spec.columns, shownColumns, sort]);

    return (
        <div className="flex flex-col gap-2">
            <div ref={root} className="relative">
                <MyTable<R>
                    data={staticTableData(visible)}
                    columns={columns}
                    columnWidths={columnWidths}
                    isLoading={false}
                    error={null}
                    currentPage={0}
                    enableColumnResizing={false}
                    enableColumnPinning={false}
                    scrollable
                    renderExpandedRow={renderExpandedRow}
                />
                {edges.before && (
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-px start-px z-10 w-6 rounded-s-lg bg-gradient-to-r from-neutral-300/60 to-transparent rtl:bg-gradient-to-l"
                    />
                )}
                {edges.after && (
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-px end-px z-10 w-8 rounded-e-lg bg-gradient-to-l from-neutral-300/70 to-transparent rtl:bg-gradient-to-r"
                    />
                )}
            </div>
            {(edges.before || edges.after) && (
                <p className="flex items-center justify-center gap-1.5 text-neutral-500">
                    <ArrowsHorizontal size={14} aria-hidden="true" />
                    <span className="text-caption">{t('table.scrollHint')}</span>
                </p>
            )}
            {rows.length > maxRows && (
                <div className="flex justify-center">
                    <MyButton
                        buttonType="text"
                        scale="medium"
                        onClick={() => setShowAll((v) => !v)}
                    >
                        {showAll
                            ? t('table.showFewer')
                            : t('table.showAll', { count: rows.length })}
                    </MyButton>
                </div>
            )}
        </div>
    );
}
