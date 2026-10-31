// editable-bulk-upload-columns.tsx
import { type ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import {
    type ValidationError,
    type SchemaFields,
} from '@/routes/manage-students/students-list/-types/bulk-upload-types';
import { cn } from '@/lib/utils';
import { Header } from '@/routes/manage-students/students-list/-schemas/student-bulk-enroll/csv-bulk-init';
import { Row } from '@tanstack/react-table';
import { CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

// Define the type for statusColumnRenderer properly
type StatusColumnRenderer = (props: { row: Row<SchemaFields> }) => JSX.Element;

interface EditableBulkUploadColumnsProps {
    csvErrors: ValidationError[];
    headers?: Header[];
    isPostUpload?: boolean;
    statusColumnRenderer?: StatusColumnRenderer;
    isEditing: boolean;
    onCellClick: (rowIndex: number, columnId: string) => void;
    editCell: { rowIndex: number; columnId: string } | null;
    handleCellEdit: (
        rowIndex: number,
        columnId: string,
        value: string,
        currentPage: number,
        ITEMS_PER_PAGE: number
    ) => void;
    onViewErrors?: (rowIndex: number) => void;
    currentPage: number;
    ITEMS_PER_PAGE: number;
    t: TFunction;
}

// Create editable bulk upload columns
export const createEditableBulkUploadColumns = ({
    csvErrors,
    headers,
    isPostUpload = false,
    statusColumnRenderer,
    isEditing,
    onCellClick,
    editCell,
    handleCellEdit,
    onViewErrors,
    currentPage,
    ITEMS_PER_PAGE,
    t,
}: EditableBulkUploadColumnsProps): Array<ColumnDef<SchemaFields>> => {
    const columns: Array<ColumnDef<SchemaFields>> = [];

    // Always include a status column, even if it's not in the headers
    const hasStatusColumn = headers?.some((h) => h.column_name === 'STATUS');

    if (!hasStatusColumn) {
        columns.push({
            id: 'status',
            header: t('columns.status'),
            cell: (props) => {
                if (statusColumnRenderer) {
                    return statusColumnRenderer({ row: props.row });
                }

                // Default renderer if custom renderer not provided
                const rowIndex = props.row.index;

                // Check if there are any errors for this row
                const rowErrors = csvErrors.filter(
                    (error) => error.path[0] === rowIndex + currentPage * ITEMS_PER_PAGE
                );
                const hasErrors = rowErrors.length > 0;

                if (!hasErrors) {
                    return (
                        <div className="flex justify-center">
                            <CheckCircle className="size-6 text-success-500" weight="fill" />
                        </div>
                    );
                }

                return (
                    <div className="flex justify-center">
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            layoutVariant="default"
                            onClick={() => onViewErrors?.(rowIndex)}
                        >
                            {t('errors.viewErrors', { count: rowErrors.length })}
                        </MyButton>
                    </div>
                );
            },
        });
    }

    // Add header columns
    headers?.forEach((header) => {
        // Handle special status column
        if (header.column_name === 'STATUS') {
            columns.push({
                id: 'status',
                header: t('columns.status'),
                cell: (props) => {
                    if (statusColumnRenderer) {
                        return statusColumnRenderer({ row: props.row });
                    }

                    // Default renderer if custom renderer not provided
                    const rowIndex = props.row.index;

                    // Check if there are any errors for this row
                    const rowErrors = csvErrors.filter((error) => error.path[0] === rowIndex);
                    const hasErrors = rowErrors.length > 0;

                    if (!hasErrors) {
                        return (
                            <div className="flex justify-center">
                                <CheckCircle className="size-6 text-success-500" weight="fill" />
                            </div>
                        );
                    }

                    return (
                        <div className="flex justify-center">
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                layoutVariant="default"
                                onClick={() => onViewErrors?.(rowIndex)}
                            >
                                {t('errors.viewErrors', { count: rowErrors.length })}
                            </MyButton>
                        </div>
                    );
                },
            });
        } else {
            columns.push({
                accessorKey: header.column_name,
                header: () => {
                    return (
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center">
                                <span>{header.column_name.replace(/_/g, ' ')}</span>
                                {!header.optional && (
                                    <span className="text-xs text-danger-500">*</span>
                                )}
                                {header.type === 'date' && header.format && (
                                    <span className="text-xs text-neutral-500">
                                        ({header.format})
                                    </span>
                                )}
                            </div>
                            {header.column_name.includes('MOBILE_NUMBER') && (
                                <span className="text-xs text-neutral-500">
                                    {t('hints.mobileNumberExample')}
                                </span>
                            )}
                        </div>
                    );
                },
                cell: ({ getValue, row, column }) => {
                    const rowIndex = row.index;
                    const columnId = column.id;
                    // const absoluteRowIndex = rowIndex + currentPage * ITEMS_PER_PAGE;
                    const error = csvErrors.find(
                        (error) =>
                            error.path[0] === rowIndex + currentPage * ITEMS_PER_PAGE &&
                            error.path[1] === header.column_name
                    );
                    const value = getValue() as string;
                    const isCurrentlyEditing =
                        editCell?.rowIndex === rowIndex && editCell?.columnId === columnId;

                    // Render editable cell if in edit mode
                    if (isEditing && isCurrentlyEditing) {
                        // For gender type fields, render a dropdown
                        if (header.type === 'gender') {
                            return (
                                <Select
                                    defaultValue={value?.toUpperCase()}
                                    onValueChange={(newValue) =>
                                        handleCellEdit(
                                            rowIndex,
                                            columnId,
                                            newValue,
                                            currentPage,
                                            ITEMS_PER_PAGE
                                        )
                                    }
                                >
                                    <SelectTrigger className={error ? 'border-danger-500' : ''}>
                                        <SelectValue placeholder={t('placeholders.selectGender')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {['MALE', 'FEMALE', 'OTHERS'].map((option) => (
                                            <SelectItem key={option} value={option}>
                                                {option}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            );
                        }

                        // For enum type fields, render a dropdown
                        if (header.type === 'enum' && header.options && header.options.length > 0) {
                            return (
                                <Select
                                    defaultValue={value}
                                    onValueChange={(newValue) =>
                                        handleCellEdit(
                                            rowIndex,
                                            columnId,
                                            newValue,
                                            currentPage,
                                            ITEMS_PER_PAGE
                                        )
                                    }
                                >
                                    <SelectTrigger className={error ? 'border-danger-500' : ''}>
                                        <SelectValue placeholder={t('placeholders.selectOption')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {header.options.map((option) => (
                                            <SelectItem key={option} value={option}>
                                                {option}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            );
                        }

                        // For other types, render a text input
                        return (
                            <Input
                                autoFocus
                                defaultValue={value}
                                className={cn(error ? 'border-danger-500' : '')}
                                onChange={(e) => e.stopPropagation()}
                                onBlur={(e) =>
                                    handleCellEdit(
                                        rowIndex,
                                        columnId,
                                        e.target.value,
                                        currentPage,
                                        ITEMS_PER_PAGE
                                    )
                                }
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        handleCellEdit(
                                            rowIndex,
                                            columnId,
                                            (e.target as HTMLInputElement).value,
                                            currentPage,
                                            ITEMS_PER_PAGE
                                        );
                                    }
                                }}
                            />
                        );
                    }

                    // Render non-editable cell
                    return (
                        <div
                            className={cn(
                                'cursor-pointer truncate',
                                error ? 'text-danger-500' : 'text-neutral-900',
                                isEditing && 'hover:bg-neutral-100'
                            )}
                            onClick={() => onCellClick(rowIndex, columnId)}
                        >
                            {header.type === 'gender' && value ? value.toUpperCase() : value}
                        </div>
                    );
                },
            });
        }
    });

    // Only add these columns if upload API was hit
    if (isPostUpload) {
        columns.push(
            {
                id: 'upload_status',
                header: t('columns.uploadStatus'),
                cell: ({ row }) => {
                    const status = row.original.STATUS;
                    const message = row.original.STATUS_MESSAGE;
                    return (
                        <div
                            className={cn(
                                'text-sm font-semibold',
                                status === 'true' ? 'text-success-500' : 'text-danger-500'
                            )}
                        >
                            {status === 'true' ? message || t('uploadResult.success') : t('uploadResult.failed')}
                        </div>
                    );
                },
            },
            {
                id: 'upload_error',
                header: t('columns.uploadError'),
                cell: ({ row }) => {
                    const error = row.original.ERROR;
                    if (!error) return null;

                    return (
                        <div className="max-w-xs whitespace-normal break-words text-sm text-danger-500">
                            {error}
                        </div>
                    );
                },
            }
        );
    }

    return columns;
};
