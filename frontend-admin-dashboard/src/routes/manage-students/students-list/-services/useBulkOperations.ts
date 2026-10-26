// services/student-operations/useBulkOperations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { STUDENT_UPDATE_OPERATION } from '@/constants/urls';
import { useToast } from '@/hooks/use-toast';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
// import { StudentTable } from "@/schemas/student/student-list/table-schema";

interface BulkUpdateBatchRequest {
    students: {
        userId: string;
        currentPackageSessionId: string;
    }[];
    newPackageSessionId: string;
}

const bulkUpdateStudentBatch = async ({
    students,
    newPackageSessionId,
}: BulkUpdateBatchRequest) => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];

    const response = await authenticatedAxiosInstance.post(STUDENT_UPDATE_OPERATION, {
        operation: 'UPDATE_BATCH',
        requests: students.map(({ userId, currentPackageSessionId }) => ({
            user_id: userId,
            new_state: newPackageSessionId,
            institute_id: INSTITUTE_ID,
            current_package_session_id: currentPackageSessionId,
        })),
    });
    return response.data;
};

export const useBulkUpdateBatchMutation = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const { t } = useTranslation('manageStudentsUseBulkOperations');

    return useMutation({
        mutationFn: bulkUpdateStudentBatch,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['students'] });
            toast({
                title: t('updateBatch.successTitle'),
                description: t('updateBatch.successDescription'),
            });
        },
        onError: (error) => {
            toast({
                title: t('updateBatch.errorTitle'),
                description: t('updateBatch.errorDescription'),
                variant: 'destructive',
            });
            console.error('Error in bulk batch update:', error);
        },
    });
};

interface BulkExtendSessionRequest {
    students: {
        userId: string;
        currentPackageSessionId: string;
    }[];
    newExpiryDate: string;
}

const bulkExtendStudentSession = async ({ students, newExpiryDate }: BulkExtendSessionRequest) => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];
    const response = await authenticatedAxiosInstance.post(STUDENT_UPDATE_OPERATION, {
        operation: 'ADD_EXPIRY',
        requests: students.map(({ userId, currentPackageSessionId }) => ({
            user_id: userId,
            new_state: newExpiryDate,
            institute_id: INSTITUTE_ID,
            current_package_session_id: currentPackageSessionId,
        })),
    });
    return response.data;
};

export const useBulkExtendSessionMutation = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const { t } = useTranslation('manageStudentsUseBulkOperations');

    return useMutation({
        mutationFn: bulkExtendStudentSession,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['students'] });
            toast({
                title: t('extendSession.successTitle'),
                description: t('extendSession.successDescription'),
            });
        },
        onError: (error) => {
            toast({
                title: t('extendSession.errorTitle'),
                description: t('extendSession.errorDescription'),
                variant: 'destructive',
            });
            console.error('Error in bulk session extension:', error);
        },
    });
};

interface BulkTerminateRequest {
    students: {
        userId: string;
        currentPackageSessionId: string;
    }[];
}

// Bulk MAKE_INACTIVE -> ssigm.status = 'INACTIVE'. See useStudentOperations for the
// single-learner equivalent and why the naming differs from the menu label.
const bulkDeactivateStudents = async ({ students }: BulkTerminateRequest) => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];
    const response = await authenticatedAxiosInstance.post(STUDENT_UPDATE_OPERATION, {
        operation: 'MAKE_INACTIVE',
        requests: students.map(({ userId, currentPackageSessionId }) => ({
            user_id: userId,
            new_state: 'INACTIVE',
            institute_id: INSTITUTE_ID,
            current_package_session_id: currentPackageSessionId,
        })),
    });
    return response.data;
};

export const useBulkDeactivateStudentsMutation = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const { t } = useTranslation('manageStudentsUseBulkOperations');

    return useMutation({
        mutationFn: bulkDeactivateStudents,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['students'] });
            toast({
                title: t('terminate.successTitle'),
                description: t('terminate.successDescription'),
            });
        },
        onError: (error) => {
            toast({
                title: t('terminate.errorTitle'),
                description: t('terminate.errorDescription'),
                variant: 'destructive',
            });
            console.error('Error in bulk termination:', error);
        },
    });
};

interface BulkDeleteRequest {
    students: {
        userId: string;
        currentPackageSessionId: string;
    }[];
}

// Bulk TERMINATE -> ssigm.status = 'TERMINATED'. Not a delete.
const bulkTerminateEnrollments = async ({ students }: BulkDeleteRequest) => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];
    const response = await authenticatedAxiosInstance.post(STUDENT_UPDATE_OPERATION, {
        operation: 'TERMINATE',
        requests: students.map(({ userId, currentPackageSessionId }) => ({
            user_id: userId,
            new_state: 'TERMINATE',
            institute_id: INSTITUTE_ID,
            current_package_session_id: currentPackageSessionId,
        })),
    });
    return response.data;
};

export const useBulkTerminateEnrollmentMutation = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const { t } = useTranslation('manageStudentsUseBulkOperations');

    return useMutation({
        mutationFn: bulkTerminateEnrollments,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['students'] });
            toast({
                title: t('delete.successTitle'),
                description: t('delete.successDescription'),
            });
        },
        onError: (error) => {
            toast({
                title: t('delete.errorTitle'),
                description: t('delete.errorDescription'),
                variant: 'destructive',
            });
            console.error('Error in bulk deletion:', error);
        },
    });
};
