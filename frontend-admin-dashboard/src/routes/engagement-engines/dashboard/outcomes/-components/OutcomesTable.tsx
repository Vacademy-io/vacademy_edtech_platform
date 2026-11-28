import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { MyTable } from '@/components/design-system/table';
import { staticTableData } from '@/components/shared/crm-enhance/group-dashboard-shell';
import { cn } from '@/lib/utils';
import type { ReportItemRow } from '@/services/engagement-daily-report';
import type { OutcomeColumn } from '../-utils/outcomes-columns';

/** Narrower than the shared header cell's default 16px sides, as on the report's tables. */
const COLUMN_PADDING = 'px-2';

interface OutcomesTableProps {
    columns: OutcomeColumn[];
    rows: ReportItemRow[];
    /** Loading: ten placeholder rows under the real headers. */
    isLoading?: boolean;
    /** The rows are the previous page while the next one loads. */
    stale?: boolean;
    /** Absent = rows are not clickable (a list with no lead behind each row). */
    onOpenRow?: (row: ReportItemRow) => void;
}

/**
 * One page of a Leads & outcomes list as a full-width MyTable. The rows arrive in the order the
 * server gives them (paging is on the server, so there is nothing to sort here); clicking any
 * cell opens the lead, and the name in the first column is the keyboard way to do the same.
 * Without `onOpenRow` (the templates list) the rows do nothing when clicked.
 */
export function OutcomesTable({ columns, rows, isLoading, stale, onOpenRow }: OutcomesTableProps) {
    const columnDefs = useMemo<ColumnDef<ReportItemRow>[]>(
        () =>
            columns.map(
                (column): ColumnDef<ReportItemRow> => ({
                    id: column.id,
                    size: column.size ?? 160,
                    header: () => (
                        <div className="break-words">
                            <span className="text-body font-semibold">{column.header}</span>
                        </div>
                    ),
                    cell: ({ row }) => {
                        const text = column.text(row.original);
                        return (
                            <span
                                title={text}
                                className={
                                    column.rich
                                        ? 'block'
                                        : column.wrap
                                          ? 'line-clamp-2 break-words'
                                          : 'block truncate'
                                }
                            >
                                {column.render ? column.render(row.original) : text}
                            </span>
                        );
                    },
                })
            ),
        [columns]
    );
    const columnWidths = useMemo(
        () => Object.fromEntries(columns.map((c) => [c.id, COLUMN_PADDING])),
        [columns]
    );

    return (
        <div className={cn('transition-opacity', stale && 'opacity-60')} aria-busy={stale}>
            <MyTable<ReportItemRow>
                data={staticTableData(rows)}
                columns={columnDefs}
                columnWidths={columnWidths}
                isLoading={!!isLoading}
                error={null}
                currentPage={0}
                enableColumnResizing={false}
                enableColumnPinning={false}
                scrollable
                onCellClick={onOpenRow ? (row) => onOpenRow(row) : undefined}
            />
        </div>
    );
}
