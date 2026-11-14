import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
    RowSelectionState,
    OnChangeFn,
    ColumnDef,
    VisibilityState,
} from '@tanstack/react-table';
import { DashboardLoader } from '../core/dashboard-loader';
import { useTranslation } from 'react-i18next';

const headerTextCss = 'p-3 border-e border-neutral-300';
const cellCommonCss = 'p-3';

export type ColumnWidthConfig = Record<string, string>;


export interface TableData<T> {
    content: T[];
    total_pages: number;
    page_no: number;
    page_size: number;
    total_elements: number;
    last: boolean;
}

interface MyTableProps<T> {
    data: TableData<T> | undefined;
    columns: ColumnDef<T>[];
    isLoading: boolean;
    error: unknown;
    onSort?: (columnId: string, direction: string) => void;
    rowSelection?: RowSelectionState;
    onRowSelectionChange?: OnChangeFn<RowSelectionState>;
    currentPage: number;
    columnWidths?: ColumnWidthConfig;
    scrollable?: boolean;
    className?: string;
    tableState?: { columnVisibility: VisibilityState };
    onCellClick?: (row: T, column: ColumnDef<T>) => void;
    onHeaderClick?: () => void;
}

export function MyTable<T>({
    data,
    columns,
    isLoading,
    error,
    onSort,
    columnWidths,
    rowSelection,
    onRowSelectionChange,
    scrollable = false,
    className = '',
    tableState,
    onCellClick,
    onHeaderClick,
}: MyTableProps<T>) {
    const { t } = useTranslation('uiAtomsA');
    const table = useReactTable({
        data: data?.content || [],
        columns,
        getCoreRowModel: getCoreRowModel(),
        meta: { onSort },
        state: {
            columnVisibility: tableState?.columnVisibility || {},
            rowSelection,
        },
        enableRowSelection: true,
        onRowSelectionChange: (updaterOrValue) => {
            if (typeof updaterOrValue === 'function') {
                if (rowSelection) {
                    const newSelection = updaterOrValue(rowSelection);
                    if (onRowSelectionChange) {
                        onRowSelectionChange(newSelection);
                    }
                }
            } else {
                if (onRowSelectionChange) {
                    onRowSelectionChange(updaterOrValue);
                }
            }
        },
        autoResetPageIndex: false,
    });


    if (isLoading) return <div>{t('table.loading')}</div>;
    if (error) return <div>{t('table.errorLoadingData')}</div>;
    if (!data) return null;
    if (!table) return <DashboardLoader />;

    return (
        <div
            className={`h-auto w-full ${
                scrollable ? 'overflow-auto' : 'overflow-visible'
            } rounded-lg border ${className}`}
        >
            <div className="max-w-full overflow-visible rounded-lg">
                <Table className="rounded-lg">
                    <TableHeader className="relative bg-primary-200">
                        {table &&
                            table?.getHeaderGroups()?.length > 0 &&
                            table?.getHeaderGroups()?.map((headerGroup) => (
                                <TableRow key={headerGroup.id} className="hover:bg-primary-200">
                                    {headerGroup.headers.map((header) => (
                                        <TableHead
                                            key={header.id}
                                            className={`${headerTextCss} overflow-visible bg-primary-100 text-subtitle font-semibold text-neutral-600 ${
                                                columnWidths?.[header.column.id] || ''
                                            }`}
                                            style={{
                                                width: columnWidths?.[header.id] || 'auto',
                                            }}
                                            onClick={() => {
                                                if (onHeaderClick) {
                                                    onHeaderClick();
                                                }
                                            }}
                                        >
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                      header.column.columnDef.header,
                                                      header.getContext()
                                                  )}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows.map((row) => (
                            <TableRow key={row.id} className="cursor-pointer hover:bg-white">
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell
                                        key={cell.id}
                                        className={`${cellCommonCss} z-10 bg-white text-body font-regular text-neutral-600 ${
                                            columnWidths?.[cell.column.id] || ''
                                        }`}
                                        onClick={() => {
                                            if (onCellClick) {
                                                onCellClick(row.original, cell.column.columnDef);
                                            }
                                        }}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
           
        </div>
    );
}
