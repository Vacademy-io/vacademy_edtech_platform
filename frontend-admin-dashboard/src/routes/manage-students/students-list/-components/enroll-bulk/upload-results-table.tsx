import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SchemaFields } from '@/routes/manage-students/students-list/-types/bulk-upload-types';
import { CheckCircle, X, Warning } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MyButton } from '@/components/design-system/button';
import { MyTable } from '@/components/design-system/table';
import { ColumnDef } from '@tanstack/react-table';
import { MyPagination } from '@/components/design-system/pagination';
import { formatReadableDate } from '@/utils/formatReadableData';

interface UploadResultsTableProps {
    data: SchemaFields[];
    onViewError?: (rowIndex: number) => void;
    onDownloadResponse?: () => void;
}

export const UploadResultsTable = ({
    data,
    onViewError,
    onDownloadResponse,
}: UploadResultsTableProps) => {
    const { t } = useTranslation('manageStudentsUploadResultsTable');
    // Calculate upload stats
    const [page, setPage] = useState(0);
    const ITEMS_PER_PAGE = 10;

    // // Create table data in the format expected by MyTable
    // const tableData = useMemo(() => {
    //     return {
    //         content: data,
    //         page_no: 0,
    //         page_size: data.length,
    //         total_elements: data.length,
    //         total_pages: 1,
    //         last: true,
    //     };
    // }, [data]);

    const paginatedData = useMemo(() => {
        const totalItems = data.length;
        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
        const start = page * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;

        return {
            content: data.slice(start, end),
            page_no: page,
            page_size: ITEMS_PER_PAGE,
            total_elements: totalItems,
            total_pages: totalPages,
            last: end >= totalItems,
        };
    }, [data, page]);
    const successCount = data.filter((row) => row.STATUS === 'true').length;
    const failedCount = data.filter((row) => row.STATUS !== 'true').length;

    // Get all unique columns from data
    const getDisplayColumns = () => {
        const excludeColumns = ['ERROR', 'PACKAGE_SESSION', 'INSTITUTE_ID'];
        const allColumns = new Set<string>();

        data.forEach((row) => {
            Object.keys(row).forEach((key) => {
                if (!excludeColumns.includes(key)) {
                    allColumns.add(key);
                }
            });
        });

        // Ensure essential columns appear first
        const essentialColumns = [
            'FULL_NAME',
            'USERNAME',
            'ENROLLMENT_NUMBER',
            'MOBILE_NUMBER',
            'EMAIL',
            'STATUS',
        ];

        const displayColumns = [...essentialColumns];

        // Add any other columns that weren't in essential columns
        [...allColumns].forEach((col) => {
            if (!displayColumns.includes(col)) {
                displayColumns.push(col);
            }
        });

        return displayColumns;
    };

    const displayColumns = getDisplayColumns();

    // Human-readable labels for the known/essential columns
    const columnLabels: Record<string, string> = {
        FULL_NAME: t('columns.fullName'),
        USERNAME: t('columns.username'),
        ENROLLMENT_NUMBER: t('columns.enrollmentNumber'),
        MOBILE_NUMBER: t('columns.mobileNumber'),
        EMAIL: t('columns.email'),
        STATUS: t('columns.status'),
    };

    // Get abbreviated error message (first line or first 100 chars)
    const getAbbreviatedError = (error: string): string => {
        if (!error) return '';
        const firstLine = error.split('\n')[0];
        if (firstLine)
            return firstLine.length > 100 ? firstLine.substring(0, 97) + '...' : firstLine;
        return '';
    };

    // Create columns definition for the table
    const columns = useMemo<ColumnDef<SchemaFields>[]>(() => {
        const tableColumns: ColumnDef<SchemaFields>[] = [];

        // Add all data columns
        displayColumns.forEach((column) => {
            tableColumns.push({
                accessorKey: column,
                header: columnLabels[column] ?? column.replace(/_/g, ' '),
                cell: ({ row }) => {
                    const value = row.original[column];

                    if (column === 'STATUS') {
                        return (
                            <div className="flex justify-center">
                                {row.original.STATUS === 'true' ? (
                                    <CheckCircle
                                        className="size-6 text-success-500"
                                        weight="fill"
                                    />
                                ) : (
                                    <X className="size-6 text-danger-500" weight="bold" />
                                )}
                            </div>
                        );
                    }

                    // Format date values
                    if (column === 'ENROLLMENT_DATE' || column === 'DATE_OF_BIRTH') {
                        return (
                            <div className="max-w-44 truncate">
                                {value ? formatReadableDate(value.toString()) : ''}
                            </div>
                        );
                    }

                    return <div className="max-w-44 truncate">{value?.toString() || ''}</div>;
                },
            });
        });

        // Add ERROR column
        tableColumns.push({
            id: 'ERROR',
            header: t('columns.error'),
            cell: ({ row }) => {
                const error = row.original.ERROR;

                if (!error) {
                    return <span className="text-success-500">{t('error.none')}</span>;
                }

                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center text-danger-500">
                                    <span className="max-w-48 truncate">
                                        {getAbbreviatedError(error as string)}
                                    </span>
                                    {onViewError && (
                                        <MyButton
                                            buttonType="text"
                                            scale="small"
                                            layoutVariant="default"
                                            className="ml-2 text-danger-500"
                                            onClick={() => onViewError(row.index)}
                                        >
                                            {t('actions.view')}
                                        </MyButton>
                                    )}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-md whitespace-pre-wrap p-3">
                                <p className="text-sm font-medium text-danger-700">
                                    {t('error.detailsLabel')}
                                </p>
                                <p className="text-xs text-neutral-600">{error}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
        });

        return tableColumns;
    }, [displayColumns, onViewError, columnLabels, t]);

    // Create column widths config for the table
    const columnWidths = useMemo(() => {
        const widths: Record<string, string> = {
            STATUS: 'w-24',
            ERROR: 'w-48',
        };

        // Set standard width for other columns
        displayColumns.forEach((column) => {
            if (column !== 'STATUS') {
                widths[column] = 'w-44';
            }
        });

        return widths;
    }, [displayColumns]);

    return (
        <div className="flex h-full flex-col gap-6">
            <div className={`flex items-center gap-4`}>
                <div className="flex items-center">
                    {failedCount > 0 ? (
                        <Warning className="size-5 text-warning-500" />
                    ) : (
                        <CheckCircle className="size-5 text-success-500" weight="fill" />
                    )}
                    <h3
                        className={`text-subtitle font-medium ${
                            failedCount > 0 ? 'text-warning-700' : 'text-success-700'
                        }`}
                    >
                        {t('summary.successCount', { count: successCount })},{' '}
                        {t('summary.failedCount', { count: failedCount })}
                    </h3>
                </div>
                {failedCount > 0 && (
                    <p className="text-body text-warning-700">
                        {t('summary.warningMessage', { column: t('columns.error') })}
                    </p>
                )}
                {onDownloadResponse && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        layoutVariant="default"
                        onClick={onDownloadResponse}
                        className="w-fit"
                    >
                        {t('actions.downloadResponse')}
                    </MyButton>
                )}
            </div>

            <div className="grow">
                <div className="no-scrollbar">
                    <div className="no-scrollbar">
                        <MyTable<SchemaFields>
                            data={paginatedData}
                            columns={columns}
                            isLoading={false}
                            error={null}
                            columnWidths={columnWidths}
                            currentPage={page}
                        />
                    </div>
                </div>
            </div>
            {data.length > ITEMS_PER_PAGE && (
                <MyPagination
                    currentPage={page + 1}
                    totalPages={paginatedData.total_pages}
                    onPageChange={(newPage) => setPage(newPage - 1)}
                />
            )}
        </div>
    );
};
