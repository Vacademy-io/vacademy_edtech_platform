// editable-bulk-upload-table.tsx
import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { type Header } from '@/routes/manage-students/students-list/-schemas/student-bulk-enroll/csv-bulk-init';
import { useBulkUploadStore } from '@/routes/manage-students/students-list/-stores/enroll-students-bulk/useBulkUploadStore';
import { StudentSearchBox } from '@/components/common/student-search-box';
import { MyPagination } from '@/components/design-system/pagination';
import { MyButton } from '@/components/design-system/button';
import {
    convertExcelDateToDesiredFormat,
    createAndDownloadCsv,
    isValidDateFormat,
} from './utils/csv-utils';
import { MyTable } from '@/components/design-system/table';
import {
    SchemaFields,
    ValidationError,
} from '@/routes/manage-students/students-list/-types/bulk-upload-types';
import { Row } from '@tanstack/react-table';
import { createEditableBulkUploadColumns } from './bulk-upload-columns';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { StatusColumnRenderer } from './status-column-rendered';
import { ErrorDetailsDialog } from './error-details-dialog';
import { Warning } from '@phosphor-icons/react';

const NAMESPACE = 'manageStudentsBulkUploadTable';
const COLUMNS_NAMESPACE = 'manageStudentsBulkUploadColumns';

/**
 * Fallback translate function for call sites that live outside a React
 * render tree (e.g. the zustand store) and therefore cannot use the
 * `useTranslation` hook. Uses the shared i18next singleton directly.
 */
const globalT: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

interface EditableBulkUploadTableProps {
    headers: Header[];
    onEdit?: (rowIndex: number, columnId: string, value: string) => void;
    affectedRows: number;
}

interface RowWithError extends SchemaFields {
    ERROR: string;
}

const ITEMS_PER_PAGE = 10;

/**
 * Validate a single cell value based on header definition.
 *
 * Accepts an optional translate function so it can be called both from
 * inside the React tree (pass the component's `t`) and from call sites
 * that sit outside it, such as the zustand store (falls back to `globalT`).
 */
export const validateCellValue = (
    value: string,
    header: Header,
    rowIndex: number,
    t: TFunction = globalT
): ValidationError | null => {
    const fieldName = header.column_name;
    const fieldLabel = fieldName.replace(/_/g, ' ');

    // Skip validation if the field is optional and empty
    if (header.optional && (!value || value.trim() === '')) {
        return null;
    }
    // const absoluteRowIndex = rowIndex + (currentPage || 0) * (ITEMS_PER_PAGE || 10);
    // Check if required field is missing
    if (!header.optional && (!value || value.trim() === '')) {
        return {
            path: [rowIndex, fieldName],
            message: t('validation.fieldRequired.message', { field: fieldLabel }),
            resolution: t('validation.fieldRequired.resolution', { field: fieldLabel }),
            currentVal: t('validation.notApplicable'),
            format: '',
        };
    }

    // If field has a value, validate according to type
    if (value) {
        // Enum validation
        if (header.type === 'enum' && header.options && header.options.length > 0) {
            if (!header.options.includes(value)) {
                return {
                    path: [rowIndex, fieldName],
                    message: t('validation.invalidValue.message', { field: fieldLabel }),
                    resolution: t('validation.invalidValue.resolution', {
                        options: header.options.join(', '),
                    }),
                    currentVal: value,
                    format: header.options.join(', '),
                };
            }
        }

        // Date validation
        if (header.type === 'date' && header.format) {
            const formattedDate = convertExcelDateToDesiredFormat(value, header.format);

            if (!isValidDateFormat(formattedDate, header.format)) {
                return {
                    path: [rowIndex, fieldName],
                    message: t('validation.invalidDate.message', { field: fieldLabel }),
                    resolution: t('validation.invalidDate.resolution', { format: header.format }),
                    currentVal: value,
                    format: header.format,
                };
            }
        }

        // Regex validation
        if (header.regex) {
            try {
                const regex = new RegExp(header.regex);
                if (!regex.test(value)) {
                    return {
                        path: [rowIndex, fieldName],
                        message:
                            header.regex_error_message ||
                            t('validation.invalidFormat.message', { field: fieldLabel }),
                        resolution: t('validation.invalidFormat.resolution'),
                        currentVal: value,
                        format: header.regex,
                    };
                }
            } catch (e) {
                console.error(`Invalid regex pattern: ${header.regex}`);
            }
        }
    }

    // No validation errors
    return null;
};

/**
 * Validate a full row of data
 */
export const validateRowData = (
    rowData: SchemaFields,
    headers: Header[],
    rowIndex: number,
    t: TFunction = globalT
): ValidationError[] => {
    const errors: ValidationError[] = [];

    // Validate each field according to its header
    headers.forEach((header) => {
        const fieldName = header.column_name;

        // Skip non-data columns like STATUS, ERROR, etc.
        if (['STATUS', 'ERROR', 'STATUS_MESSAGE'].includes(fieldName)) {
            return;
        }

        const value = rowData[fieldName] as string;
        const error = validateCellValue(value, header, rowIndex, t);

        if (error) {
            errors.push(error);
        }
    });

    return errors;
};

/**
 * Revalidate all data in the CSV
 */
export const revalidateAllData = (
    data: SchemaFields[],
    headers: Header[],
    t: TFunction = globalT
): ValidationError[] => {
    let allErrors: ValidationError[] = [];

    // Validate each row
    data.forEach((row, rowIndex) => {
        const rowErrors = validateRowData(row, headers, rowIndex, t);
        allErrors = [...allErrors, ...rowErrors];
    });

    return allErrors;
};

/**
 * Check if a response row has errors
 */
export const hasErrors = (row: SchemaFields): boolean => {
    return row.STATUS === 'false' || !!row.ERROR;
};

/**
 * Get upload statistics from response data
 */
export const getUploadStats = (responseData: SchemaFields[]) => {
    if (!responseData || responseData.length === 0) {
        return { successful: 0, failed: 0, total: 0 };
    }

    let successful = 0;
    let failed = 0;

    responseData.forEach((row) => {
        if (row.STATUS === 'true') {
            successful++;
        } else {
            failed++;
        }
    });

    return {
        successful,
        failed,
        total: responseData.length,
    };
};

export function EditableBulkUploadTable({
    headers,
    onEdit,
    affectedRows,
}: EditableBulkUploadTableProps) {
    const { t } = useTranslation([NAMESPACE, COLUMNS_NAMESPACE]);
    // `createEditableBulkUploadColumns` owns its own namespace
    // (COLUMNS_NAMESPACE); wrap `t` so its keys resolve there while every
    // other call in this file keeps resolving against NAMESPACE by default.
    const tColumns: TFunction = ((key: string, options?: Record<string, unknown>) =>
        t(key, { ns: COLUMNS_NAMESPACE, ...options })) as TFunction;
    const { csvData, csvErrors, setIsEditing, isEditing, setCsvData } = useBulkUploadStore();
    const [page, setPage] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [searchFilter, setSearchFilter] = useState('');
    const [editCell, setEditCell] = useState<{ rowIndex: number; columnId: string } | null>(null);
    const { setCsvErrors } = useBulkUploadStore();
    const [showErrorDialog, setShowErrorDialog] = useState(false);
    const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

    const handleCellEdit = (
        rowIndex: number,
        columnId: string,
        value: string,
        currentPage: number,
        ITEMS_PER_PAGE: number
    ) => {
        if (!csvData) return;

        // Create a new data array with the updated value
        const newData = [...csvData];
        newData[rowIndex + currentPage * ITEMS_PER_PAGE] = {
            ...newData[rowIndex + currentPage * ITEMS_PER_PAGE],
            [columnId]: value,
        };

        // Update the data
        setCsvData(newData);

        // Find the header for this column to use in validation
        // const absoluteRowIndex = rowIndex + currentPage * ITEMS_PER_PAGE;
        const header = headers.find((h) => h.column_name === columnId);
        if (header) {
            // Remove old errors for this specific cell
            const updatedErrors = csvErrors.filter(
                (error) =>
                    !(
                        error.path[0] === rowIndex + currentPage * ITEMS_PER_PAGE &&
                        error.path[1] === columnId
                    )
            );

            // Validate the new value
            const cellError = validateCellValue(value, header, rowIndex, t);

            // Set updated errors
            setCsvErrors(cellError ? [...updatedErrors, cellError] : updatedErrors);
        }

        // Call external edit handler if provided
        if (onEdit) {
            onEdit(rowIndex, columnId, value);
        }

        setEditCell(null);
    };

    const statusColumnRenderer = React.useCallback(
        ({ row }: { row: Row<SchemaFields> }) => {
            return (
                <StatusColumnRenderer
                    row={row}
                    csvErrors={csvErrors}
                    csvData={csvData}
                    currentPage={page}
                    ITEMS_PER_PAGE={ITEMS_PER_PAGE}
                />
            );
        },
        [csvErrors, csvData, page]
    );

    const handleViewErrors = (rowIndex: number) => {
        setSelectedRowIndex(rowIndex);
        setShowErrorDialog(true);
    };

    const columns = useMemo(() => {
        return createEditableBulkUploadColumns({
            csvErrors,
            headers,
            isPostUpload: false,
            statusColumnRenderer,
            isEditing,
            onCellClick: (rowIndex, columnId) => {
                if (isEditing) {
                    console.log('cell needs to be edited now');
                    setEditCell({ rowIndex, columnId });
                }
            },
            editCell,
            handleCellEdit,
            onViewErrors: handleViewErrors,
            currentPage: page,
            ITEMS_PER_PAGE: ITEMS_PER_PAGE,
            t: tColumns,
        });
    }, [
        csvErrors,
        headers,
        statusColumnRenderer,
        isEditing,
        editCell,
        csvData,
        handleCellEdit,
        tColumns,
    ]);

    const filteredData = useMemo(() => {
        if (!csvData) return [];
        return csvData.filter((row) =>
            Object.values(row).some((value) =>
                value?.toString().toLowerCase().includes(searchFilter.toLowerCase())
            )
        );
    }, [csvData, searchFilter]);

    const paginatedData = useMemo(() => {
        const totalItems = filteredData.length;
        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

        // Ensure page is never out of bounds
        const safePage = Math.max(0, Math.min(page, Math.max(0, totalPages - 1)));

        // Reset to page 0 if we're on an invalid page
        if (safePage !== page) {
            setPage(safePage);
        }

        const start = safePage * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;

        return {
            content: filteredData.slice(start, end),
            page_no: safePage,
            page_size: ITEMS_PER_PAGE,
            total_elements: totalItems,
            total_pages: totalPages,
            last: end >= totalItems,
        };
    }, [filteredData, page]);

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchInput(event.target.value);
    };

    const handleSearchEnter = () => {
        setSearchFilter(searchInput);
        setPage(0); // Reset to first page when searching
    };

    const handleClearSearch = () => {
        setSearchInput('');
        setSearchFilter('');
        setPage(0); // Reset to first page when clearing search
    };

    const downloadErrorCases = () => {
        if (!csvData) return;

        const errorMessages: Record<number, string[]> = {};
        csvErrors.forEach((error) => {
            const [rowIndex, column] = error.path;
            if (!errorMessages[rowIndex]) {
                errorMessages[rowIndex] = [];
            }
            errorMessages[rowIndex]?.push(`(${column}: ${error.message})`);
        });

        const dataWithErrors = csvData
            .map((row, index) => {
                if (errorMessages[index]) {
                    const errorRow: RowWithError = {
                        ...row,
                        ERROR: errorMessages[index]?.join(', ') || t('errors.unknownError'),
                    };
                    return errorRow;
                }
                return null;
            })
            .filter((row): row is RowWithError => row !== null);

        createAndDownloadCsv(dataWithErrors, 'ERROR_CASES.csv');
    };

    const downloadValidData = () => {
        if (!csvData) return;

        const validData = csvData.filter(
            (_, index) => !csvErrors.some((error) => error.path[0] === index)
        );

        createAndDownloadCsv(validData, 'VALID_DATA.csv');
    };

    const toggleEditing = (value: boolean) => {
        setIsEditing(value);
        setEditCell(null); // Reset any active edit cell when toggling
    };

    return paginatedData.content.length === 0 ? (
        <p className="w-full text-center text-subtitle text-primary-500">
            {t('emptyState.noData')}
        </p>
    ) : (
        <div className="flex flex-col gap-6 pr-10">
            <div className="fixed top-14 z-50 flex w-[78vw] items-center justify-between border-b border-b-neutral-300 bg-white py-2">{/* design-lint-ignore: viewport-relative fixed toolbar spanning the table area (excludes sidebar), no fixed-width token fits */}
                <div className="flex items-center gap-2">
                    <StudentSearchBox
                        searchInput={searchInput}
                        searchFilter={searchFilter}
                        onSearchChange={handleSearchChange}
                        onSearchEnter={handleSearchEnter}
                        onClearSearch={handleClearSearch}
                    />
                    <div className="sticky top-0 flex items-center gap-2">
                        <Switch
                            checked={isEditing}
                            onCheckedChange={toggleEditing}
                            id="edit-mode"
                        />
                        <Label htmlFor="edit-mode" className="font-medium text-neutral-900">
                            {t('editingMode.label')}
                        </Label>
                    </div>
                    {isEditing && (
                        <div className="text-sm text-primary-500">{t('editingMode.hint')}</div>
                    )}
                </div>
                <div className="flex items-center gap-4">
                    {csvErrors.length > 0 && (
                        <div className="rounded-md">
                            <div className="flex items-center">
                                <Warning className="size-5 text-danger-500" />
                                <h3 className="ml-2 text-sm font-medium text-danger-700">
                                    {t('summary.foundIssuesInRows', {
                                        issues: t('summary.issuesCount', {
                                            count: csvErrors.length,
                                        }),
                                        rows: t('summary.rowsCount', { count: affectedRows }),
                                    })}
                                </h3>
                            </div>
                        </div>
                    )}
                    {csvErrors.length > 0 && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="default"
                            onClick={downloadErrorCases}
                        >
                            {t('buttons.downloadErrorCases')}
                        </MyButton>
                    )}
                    {csvData && csvData.length > 0 && csvErrors.length === 0 && (
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            layoutVariant="default"
                            onClick={downloadValidData}
                        >
                            {t('buttons.downloadValidData')}
                        </MyButton>
                    )}
                </div>
            </div>

            <div className="no-scrollbar mt-12 bg-white">
                <div className="no-scrollbar">
                    <MyTable<SchemaFields>
                        data={paginatedData}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        columnWidths={{
                            STATUS: 'w-24',
                            status: 'w-24',
                            error: 'w-48',
                            ...headers.reduce(
                                (acc, header) => ({
                                    ...acc,
                                    [header.column_name]: 'min-w-56',
                                }),
                                {}
                            ),
                        }}
                        currentPage={page}
                    />
                </div>
            </div>

            <div className="fixed bottom-0 left-[30vw] end-0 z-50 w-fit bg-white py-2">{/* design-lint-ignore: viewport-relative offset aligning the fixed pagination bar under the table, no fixed-width token fits */}
                <MyPagination
                    currentPage={page}
                    totalPages={paginatedData.total_pages}
                    onPageChange={(newPage) => setPage(newPage)}
                />
            </div>

            <ErrorDetailsDialog
                isOpen={showErrorDialog}
                onClose={() => setShowErrorDialog(!showErrorDialog)}
                errors={
                    selectedRowIndex !== null
                        ? csvErrors.filter(
                              (error) => error.path[0] === selectedRowIndex + page * ITEMS_PER_PAGE
                          )
                        : []
                }
                rowData={
                    selectedRowIndex !== null
                        ? csvData?.[selectedRowIndex + page * ITEMS_PER_PAGE] || {}
                        : {}
                }
            />
        </div>
    );
}
