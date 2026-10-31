import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { ErrorDetailsDialog } from './error-details-dialog';
import {
    SchemaFields,
    ValidationError,
} from '@/routes/manage-students/students-list/-types/bulk-upload-types';
import { Row } from '@tanstack/react-table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface StatusColumnRendererProps {
    row: Row<SchemaFields>;
    csvErrors: ValidationError[];
    csvData: SchemaFields[] | undefined;
    currentPage: number;
    ITEMS_PER_PAGE: number;
}

export const StatusColumnRenderer: React.FC<StatusColumnRendererProps> = ({
    row,
    csvErrors,
    csvData,
    currentPage,
    ITEMS_PER_PAGE,
}) => {
    const { t } = useTranslation('manageStudentsStatusColumnRendered');
    const [showErrorDialog, setShowErrorDialog] = useState(false);
    const rowIndex = row.index;
    const rowData = row.original;

    // Check if this is a post-upload row with API response status
    const isPostUploadRow = rowData.STATUS !== undefined;
    const apiSuccess = isPostUploadRow && rowData.STATUS === 'true';
    const apiError =
        isPostUploadRow && !apiSuccess ? rowData.ERROR || rowData.STATUS_MESSAGE : null;

    // If this is a post-upload row, render based on API response
    if (isPostUploadRow) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex justify-center">
                            {apiSuccess ? (
                                <CheckCircle className="size-6 text-success-500" weight="fill" />
                            ) : (
                                <div className="flex items-center justify-center">
                                    <X className="size-6 text-danger-500" weight="bold" />
                                </div>
                            )}
                        </div>
                    </TooltipTrigger>
                    {!apiSuccess && apiError && (
                        <TooltipContent className="max-w-xs">
                            <p className="text-sm text-danger-700">
                                {typeof apiError === 'string' && apiError.length > 100
                                    ? apiError.substring(0, 97) + '...'
                                    : apiError || t('apiStatus.uploadFailed')}
                            </p>
                        </TooltipContent>
                    )}
                </Tooltip>

                {!apiSuccess && showErrorDialog && (
                    <ErrorDetailsDialog
                        isOpen={showErrorDialog}
                        onClose={() => setShowErrorDialog(false)}
                        errors={[
                            {
                                path: [rowIndex, 'ERROR'],
                                message: t('apiStatus.uploadFailed'),
                                resolution: t('apiStatus.errorResolution'),
                                currentVal: String(apiError || t('apiStatus.unknownError')),
                                format: '',
                            },
                        ]}
                        rowData={rowData}
                        isApiError={true}
                    />
                )}
            </TooltipProvider>
        );
    }

    // For pre-upload validation errors
    const absoluteRowIndex = rowIndex + currentPage * ITEMS_PER_PAGE;
    const validationErrors = csvErrors.filter((error) => error.path[0] === absoluteRowIndex);

    if (validationErrors.length === 0) {
        return (
            <div className="flex justify-center">
                <CheckCircle className="size-6 text-success-500" weight="fill" />
            </div>
        );
    }

    return (
        <>
            <div className="flex justify-center">
                <MyButton
                    buttonType="primary"
                    scale="small"
                    layoutVariant="default"
                    onClick={() => setShowErrorDialog(true)}
                    className="bg-danger-600"
                >
                    {t('validationErrors.errorsButton', { count: validationErrors.length })}
                </MyButton>
            </div>

            {showErrorDialog && (
                <ErrorDetailsDialog
                    isOpen={showErrorDialog}
                    onClose={() => setShowErrorDialog(false)}
                    errors={validationErrors}
                    rowData={
                        (csvData && rowIndex >= 0 && rowIndex < csvData.length
                            ? csvData[rowIndex]
                            : {}) as SchemaFields
                    }
                />
            )}
        </>
    );
};
