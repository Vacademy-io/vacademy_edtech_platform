import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTrigger,
} from '@/components/ui/dialog';
import { DialogDescription } from '@radix-ui/react-dialog';
import { MyButton } from '@/components/design-system/button';
import ImportFileImage from '@/assets/svgs/import-file.svg';
import { useBulkUploadInit } from '@/routes/manage-students/students-list/-hooks/enroll-student-bulk/useBulkUploadInit';
import { useState, useCallback, Dispatch, SetStateAction, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDropzone } from 'react-dropzone';
import { validateCsvData, createAndDownloadCsv } from './utils/csv-utils';
import { useBulkUploadStore } from '@/routes/manage-students/students-list/-stores/enroll-students-bulk/useBulkUploadStore';
import { SchemaFields } from '@/routes/manage-students/students-list/-types/bulk-upload-types';
import {
    CSVFormatFormType,
    enrollBulkFormType,
} from '@/routes/manage-students/students-list/-schemas/student-bulk-enroll/enroll-bulk-schema';
import { parseApiResponse, getUploadStats } from './utils/parse-api-response-string';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useBulkUploadMutation } from '@/routes/manage-students/students-list/-hooks/enroll-student-bulk/useBulkUploadMutation';
import { PreviewDialog } from './preview-dialog';
import { toast } from 'sonner';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useQueryClient } from '@tanstack/react-query';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyDialog } from '@/components/design-system/dialog';
import { useBulkDialog } from '../../-context/bulk-dialog-context';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';

interface FileState {
    file: File | null;
    error?: string;
}

interface UploadCSVButtonProps {
    disable?: boolean;
    packageDetails: enrollBulkFormType;
    csvFormatDetails: CSVFormatFormType;
    setOpenDialog?: Dispatch<SetStateAction<boolean>>; // New prop to close CSV Format Dialog
}

// Define a more specific type for API responses
//  interface ApiResponse {
//     data?: SchemaFields[] | string;
//     success?: boolean;
//     message?: string;
//     status?: number;
// }

export const UploadCSVButton = ({
    disable,
    packageDetails,
    csvFormatDetails,
    setOpenDialog,
}: UploadCSVButtonProps) => {
    const { t } = useTranslation('manageStudentsUploadCsvButton');
    const { t: tCsvUtils } = useTranslation('manageStudentsCsvUtils');
    const [isOpen, setIsOpen] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [fileState, setFileState] = useState<FileState>({ file: null });
    const [uploadCompleted, setUploadCompleted] = useState(false);
    const [uploadResponse, setUploadResponse] = useState<SchemaFields[] | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const { mutateAsync } = useBulkUploadMutation();
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];
    const { csvData, setCsvData, csvErrors, setCsvErrors } = useBulkUploadStore();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const packageSessionId = getPackageSessionId({
        courseId: packageDetails.course.id || '',
        sessionId: packageDetails.session.id || '',
        levelId: packageDetails.level.id || '',
    });
    const queryClient = useQueryClient();
    const [showNotificationDialog, setShowNotificationDialog] = useState(false);
    const { setEnrollStudentDialogOpen } = useBulkDialog();
    // Function to close all dialogs
    const closeAllDialogs = () => {
        setIsOpen(false);
        // Close the CSV Format Dialog if it's open
        if (setOpenDialog) {
            setOpenDialog(false);
        }

        // Close the preview dialog
        setShowPreview(false);

        setEnrollStudentDialogOpen(false);
    };

    const requestPayload = {
        auto_generate_config: {
            auto_generate_username: csvFormatDetails.autoGenerateUsername,
            auto_generate_password: csvFormatDetails.autoGeneratePassword,
            auto_generate_enrollment_id: csvFormatDetails.autoGenerateEnrollmentId,
        },
        optional_fields_config: {
            include_address_line: false,
            include_region: csvFormatDetails.state,
            include_city: csvFormatDetails.city,
            include_pin_code: csvFormatDetails.pincode,
            include_father_name: csvFormatDetails.fatherName,
            include_mother_name: csvFormatDetails.motherName,
            include_parents_mobile_number: csvFormatDetails.fatherMobile,
            include_parents_email: csvFormatDetails.fatherEmail,
            include_parents_to_mother_email: csvFormatDetails.motherEmail,
            include_parents_to_mother_mobile: csvFormatDetails.motherMobile,
            include_linked_institute_name: csvFormatDetails.collegeName,
        },
        expiry_and_status_config: {
            include_expiry_days: csvFormatDetails.setCommonExpiryDate,
            include_enrollment_status: csvFormatDetails.addStudentStatus,
            expiry_days: parseInt(csvFormatDetails.daysFromToday),
            enrollment_status: csvFormatDetails.studentStatus,
        },
    };

    const { data, isLoading } = useBulkUploadInit(
        {
            instituteId: INSTITUTE_ID || '',
            bulkUploadInitRequest: requestPayload,
        },
        {
            enabled: isOpen,
        }
    );

    const onDrop = useCallback(
        async (acceptedFiles: File[], rejectedFiles: unknown[]) => {
            if (rejectedFiles.length > 0) {
                setFileState({ file: null, error: t('errors.csvOnly') });
                return;
            }

            const file = acceptedFiles[0];
            if (file?.type !== 'text/csv' && !file?.name.endsWith('.csv')) {
                setFileState({ file: null, error: t('errors.csvOnly') });
                return;
            }

            if (!data?.headers) {
                setFileState({ file: null, error: t('errors.headersUnavailable') });
                return;
            }

            setFileState({ file });
            setUploadCompleted(false);
            setUploadResponse(null);

            try {
                // Pass headers to the validation function
                const result = await validateCsvData(file, data.headers, tCsvUtils);

                // Filter out completely empty rows
                const nonEmptyRows = result.data.filter((row) => {
                    return Object.values(row).some(
                        (value) => value && (typeof value === 'string' ? value.trim() !== '' : true)
                    );
                });

                setCsvData(nonEmptyRows);
                setCsvErrors(result.errors);

                // Show error summary if any errors exist
                if (result.errors.length > 0) {
                    toast.error(t('errors.fixValidationErrors'), {
                        className: 'error-toast',
                        duration: 3000,
                    });
                }
            } catch (err) {
                const error = err instanceof Error ? err.message : t('errors.parseCsv');
                setFileState({ file: null, error });
                toast.error(t('errors.parseCsv'), {
                    className: 'error-toast',
                    duration: 3000,
                });
            }
        },
        [data?.headers, setCsvData, setCsvErrors, t]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'text/csv': ['.csv'],
        },
        maxFiles: 1,
    });

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setFileState({ file: null });
            setCsvData(undefined);
            // setCsvErrors([]);
        }
        setIsOpen(open);
    };

    const handleEditCell = (rowIndex: number, columnId: string, value: string) => {
        // const absoluteRowIndex = rowIndex + currentPage * ITEMS_PER_PAGE;
        console.log(`Editing cell: row ${rowIndex}, column ${columnId}, new value: ${value}`);
    };

    const handleDownloadTemplate = () => {
        if (data?.headers) {
            const sortedHeaders = [...data.headers].sort((a, b) => a.order - b.order);
            const headerRow = sortedHeaders.map((header) => header.column_name);
            const sampleRows = Array.from({ length: 3 }, (unused, rowIndex) =>
                sortedHeaders.map((header) => header.sample_values[rowIndex] || '')
            );

            const templateData = sampleRows.map((row) => {
                return headerRow.reduce(
                    (acc, header, index) => {
                        acc[header] = row[index] || '';
                        return acc;
                    },
                    {} as Record<string, string | number | boolean>
                );
            });

            createAndDownloadCsv(templateData as SchemaFields[], 'student_enrollment_template.csv');
        }
    };

    const handleDoneClick = async () => {
        // Check if there are validation errors before proceeding with upload
        if (csvErrors && csvErrors.length > 0) {
            toast.error(t('errors.fixErrors'), {
                className: 'error-toast',
                duration: 3000,
            });

            // Automatically open preview to show errors
            setShowPreview(true);
            return;
        }

        // Show notification dialog before proceeding with upload
        setShowNotificationDialog(true);
    };

    const handleNotificationConfirm = async (notify: boolean) => {
        setShowNotificationDialog(false);
        await uploadCsv(notify);
    };

    const uploadCsv = async (notify: boolean) => {
        if (!csvData || !fileState.file) return;

        try {
            setIsUploading(true);
            const response = await mutateAsync({
                data: csvData,
                instituteId: INSTITUTE_ID || '',
                bulkUploadInitRequest: requestPayload,
                packageSessionId: packageSessionId || '',
                notify,
            });

            // Parse the response
            const parsedResponse = parseApiResponse(response);
            setUploadResponse(parsedResponse);
            setUploadCompleted(true);

            // Show success message with upload stats
            const stats = getUploadStats(parsedResponse);
            toast.success(
                t('toast.uploadCompleted', { success: stats.success, failed: stats.failed }),
                {
                    className: 'success-toast',
                    duration: 3000,
                }
            );

            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ['students'] });

            // Close other dialogs first
            // closeAllDialogs();
            // Then show preview dialog
            setShowPreview(true);
        } catch (error) {
            console.error('Upload failed:', error);
            toast.error(t('errors.uploadFailed'), {
                className: 'error-toast',
                duration: 3000,
            });
        } finally {
            setIsUploading(false);
        }
    };

    const handleDownloadResponse = () => {
        if (uploadResponse && uploadResponse.length > 0) {
            createAndDownloadCsv(uploadResponse, 'upload_response.csv');
        }
    };

    useEffect(() => {
        if (fileState.file) {
            setShowPreview(true);
        }
    }, [fileState.file]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center">
                <DashboardLoader />
            </div>
        );
    }

    return (
        <>
            <Dialog open={isOpen} onOpenChange={handleOpenChange}>
                <DialogTrigger asChild>
                    <MyButton
                        buttonType="primary"
                        scale="large"
                        layoutVariant="default"
                        disabled={disable || false}
                        type="submit"
                    >
                        {t('button.uploadCsv')}
                    </MyButton>
                </DialogTrigger>

                <DialogContent className="overflow-y-scrolly max-h-dialog-tall w-dialog-lg p-0 font-normal">
                    {isUploading ? (
                        <div className="flex items-center justify-center">
                            <DashboardLoader />
                        </div>
                    ) : (
                        <DialogHeader>
                            <div className="bg-primary-50 px-6 py-4 text-h3 font-semibold text-primary-500">
                                {t('dialog.title')}
                            </div>
                            <DialogDescription className="flex flex-col items-center justify-center gap-6 p-6 text-neutral-600">
                                <div
                                    {...getRootProps()}
                                    className={`h-64 w-full cursor-pointer rounded-lg border-2 border-dashed border-primary-500 p-6 ${isDragActive ? 'bg-primary-50' : 'bg-white'
                                        } transition-colors duration-200 ease-in-out`}
                                >
                                    <input {...getInputProps()} />
                                    <div className="flex flex-col items-center justify-center gap-4">
                                        <ImportFileImage />
                                        {!fileState.file && (
                                            <p className="text-center text-neutral-600">
                                                {t('dropzone.instructions')}
                                            </p>
                                        )}
                                        {fileState.file && (
                                            <div className="text-center">
                                                <p className="font-medium text-primary-500">
                                                    {fileState.file.name}
                                                </p>
                                                <p className="text-sm text-neutral-500">
                                                    {t('dropzone.fileSizeKb', {
                                                        size: (fileState.file.size / 1024).toFixed(
                                                            2
                                                        ),
                                                    })}
                                                </p>
                                            </div>
                                        )}
                                        {fileState.error && (
                                            <p className="text-sm text-danger-600">
                                                {fileState.error}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-col items-center">
                                    <div className="flex gap-1 text-center">
                                        {data?.instructions?.map((instruction, index) => (
                                            <p key={index}>{instruction}.</p>
                                        ))}
                                    </div>
                                    <MyButton
                                        className="cursor-pointer text-title font-semibold text-primary-500"
                                        buttonType="text"
                                        layoutVariant="default"
                                        scale="medium"
                                        onClick={handleDownloadTemplate}
                                    >
                                        {t('button.downloadTemplate')}
                                    </MyButton>
                                </div>
                            </DialogDescription>
                            <DialogFooter className="px-6 py-4">
                                <div className="flex w-full justify-between">
                                    <MyButton
                                        buttonType="secondary"
                                        scale="large"
                                        layoutVariant="default"
                                        type="button"
                                        onClick={() => setShowPreview(true)}
                                        disabled={!fileState.file || !data?.headers}
                                    >
                                        {uploadCompleted
                                            ? t('button.showUploadedFile')
                                            : t('button.preview')}
                                    </MyButton>
                                    <MyButton
                                        buttonType="primary"
                                        scale="large"
                                        layoutVariant="default"
                                        type="button"
                                        onClick={handleDoneClick}
                                        disabled={!fileState.file}
                                    >
                                        {t('button.upload')}
                                    </MyButton>
                                </div>
                            </DialogFooter>
                        </DialogHeader>
                    )}
                </DialogContent>
            </Dialog>

            {/* Preview Dialog */}
            {showPreview && (
                <PreviewDialog
                    isOpen={showPreview}
                    onClose={() => setShowPreview(false)}
                    file={fileState.file}
                    headers={data?.headers || []}
                    onEdit={handleEditCell}
                    uploadCompleted={uploadCompleted}
                    uploadResponse={uploadResponse}
                    onDownloadResponse={handleDownloadResponse}
                    closeAllDialogs={closeAllDialogs}
                    instituteId={INSTITUTE_ID || ''}
                    packageSessionId={packageSessionId || ''}
                />
            )}

            {/* Notification Confirmation Dialog */}
            <MyDialog
                open={showNotificationDialog}
                onOpenChange={setShowNotificationDialog}
                heading={t('notification.heading')}
                dialogWidth="w-dialog-md"
                footer={
                    <div className="flex justify-end gap-4">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            layoutVariant="default"
                            onClick={() => handleNotificationConfirm(false)}
                        >
                            {t('notification.dontNotify')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            layoutVariant="default"
                            onClick={() => handleNotificationConfirm(true)}
                        >
                            {t('notification.notify', {
                                term: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
                            })}
                        </MyButton>
                    </div>
                }
            >
                <div className="p-4">
                    <p className="text-neutral-600">
                        {t('notification.description', {
                            term:
                                getTerminology(
                                    RoleTerms.Learner,
                                    SystemTerms.Learner
                                ).toLocaleLowerCase() + 's',
                        })}
                    </p>
                </div>
            </MyDialog>
        </>
    );
};
