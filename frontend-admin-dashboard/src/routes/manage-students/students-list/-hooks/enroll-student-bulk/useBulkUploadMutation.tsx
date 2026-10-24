import { useMutation, UseMutationOptions } from '@tanstack/react-query';
import {
    CSVFormatConfig,
    SchemaFields,
} from '@/routes/manage-students/students-list/-types/bulk-upload-types';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { STUDENT_CSV_UPLOAD_URL } from '@/constants/urls';
import axios from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getSelectedSubOrgId } from '@/lib/auth/facultyAccessUtils';
import { useTranslation } from 'react-i18next';

interface SubmitBulkUploadParams {
    data: SchemaFields[];
    instituteId: string;
    bulkUploadInitRequest: CSVFormatConfig;
    packageSessionId: string;
    notify: boolean;
}

// Define the mutation function separately
const submitBulkUploadData = async ({
    data,
    instituteId,
    bulkUploadInitRequest,
    packageSessionId,
    notify,
}: SubmitBulkUploadParams): Promise<string> => {
    // Create form data
    const formData = new FormData();

    // Add instituteId and bulkUploadInitRequest as form fields
    formData.append('instituteId', instituteId);
    formData.append('bulkUploadInitRequest', JSON.stringify(bulkUploadInitRequest));
    formData.append('packageSessionId', packageSessionId);
    formData.append('notify', notify.toString());
    const subOrgId = getSelectedSubOrgId();
    if (subOrgId) {
        formData.append('subOrgId', subOrgId);
    }
    // Convert data to CSV and append as file
    const csvContent = Papa.unparse(data);
    const csvFile = new File([csvContent], 'students.csv', { type: 'text/csv' });
    formData.append('file', csvFile);

    // Make API call
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: STUDENT_CSV_UPLOAD_URL,
        data: formData,
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });

    return response.data;
};

export const useBulkUploadMutation = (
    options?: Omit<UseMutationOptions<string, Error, SubmitBulkUploadParams, unknown>, 'mutationFn'>
) => {
    const { t } = useTranslation('manageStudentsUseBulkUploadMutation');

    return useMutation<string, Error, SubmitBulkUploadParams, unknown>({
        mutationFn: submitBulkUploadData,
        onSuccess: (data, variables, context) => {
            toast.success(t('toast.uploadSuccess'));
            if (options?.onSuccess) {
                options.onSuccess(data, variables, context);
            }
        },
        onError: (error, variables, context) => {
            if (axios.isAxiosError(error)) {
                console.error('Upload error details:', {
                    response: error.response?.data,
                    status: error.response?.status,
                    headers: error.response?.headers,
                });
                toast.error(error.response?.data?.message || t('toast.uploadFailed'));
            } else {
                console.error('Unexpected error:', error);
                toast.error(t('toast.unexpectedError'));
            }

            if (options?.onError) {
                options.onError(error, variables, context);
            }
        },
        ...options,
    });
};
