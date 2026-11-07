import type { ReactNode } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface TeamColumn<T> {
    id: string;
    header: string;
    /** Width / alignment utilities for the whole column. */
    className?: string;
    /** Clicks and keys inside this cell stay in the cell (buttons, menus, copy). */
    interactive?: boolean;
    cell: (row: T) => ReactNode;
}

interface TeamTableProps<T extends { id: string }> {
    rows: T[];
    columns: TeamColumn<T>[];
    loading: boolean;
    onRowClick: (row: T) => void;
    /** Accessible name for a row, e.g. "Open Priya Sharma". */
    rowLabel: (row: T) => string;
    skeletonRows?: number;
}

/**
 * The Teams list: full-width rows on the card, a quiet uppercase header and a whole-row
 * click target. Built on the ui/table primitives rather than MyTable because this screen
 * needs the reviewed look (no resize handles, no tinted header, rows that fill the card).
 */
export function TeamTable<T extends { id: string }>({
    rows,
    columns,
    loading,
    onRowClick,
    rowLabel,
    skeletonRows = 6,
}: TeamTableProps<T>) {
    return (
        <Table className="min-w-table-sm">
            <TableHeader className="bg-neutral-50">
                <TableRow className="border-b border-neutral-200 hover:bg-neutral-50">
                    {columns.map((column) => (
                        <TableHead
                            key={column.id}
                            className={cn('h-10 whitespace-nowrap px-4', column.className)}
                        >
                            {/* Size + colour on a span: TableHead re-runs cn(), which would
                                drop text-caption next to a text colour. */}
                            <span className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                {column.header}
                            </span>
                        </TableHead>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {loading
                    ? Array.from({ length: skeletonRows }).map((_, index) => (
                          <TableRow
                              key={`skeleton-${index}`}
                              className="border-b border-neutral-100 hover:bg-transparent"
                          >
                              {columns.map((column) => (
                                  <TableCell key={column.id} className="p-4">
                                      <Skeleton className="h-4 w-full max-w-40 bg-neutral-100" />
                                  </TableCell>
                              ))}
                          </TableRow>
                      ))
                    : rows.map((row) => (
                          <TableRow
                              key={row.id}
                              tabIndex={0}
                              aria-label={rowLabel(row)}
                              onClick={() => onRowClick(row)}
                              onKeyDown={(event) => {
                                  if (event.target !== event.currentTarget) return;
                                  if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      onRowClick(row);
                                  }
                              }}
                              className="cursor-pointer border-b border-neutral-100 hover:bg-primary-50 focus-visible:bg-primary-50 focus-visible:outline-none"
                          >
                              {columns.map((column) => (
                                  <TableCell
                                      key={column.id}
                                      className={cn('px-4 py-3', column.className)}
                                      // Radix menus portal out, but React events still bubble
                                      // through the component tree — stop them at the cell.
                                      onClick={
                                          column.interactive
                                              ? (event) => event.stopPropagation()
                                              : undefined
                                      }
                                      onKeyDown={
                                          column.interactive
                                              ? (event) => event.stopPropagation()
                                              : undefined
                                      }
                                  >
                                      {column.cell(row)}
                                  </TableCell>
                              ))}
                          </TableRow>
                      ))}
            </TableBody>
        </Table>
    );
}
