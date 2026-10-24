import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    BULK_ASSIGN_LEARNERS,
    BULK_DEASSIGN_LEARNERS,
    GET_INVITE_LINKS,
    GET_SINGLE_INVITE_DETAILS,
    GET_DEFAULT_INVITE,
} from '@/constants/urls';
import type {
    BulkAssignRequest,
    BulkAssignResponse,
    BulkDeassignRequest,
    BulkDeassignResponse,
    EnrollInviteDTO,
} from '@/routes/manage-students/students-list/-types/bulk-assign-types';

// Every list that shows enrollment state. The learner list is cached for
// 30s with refetchOnMount off, so without this an assign/de-assign only
// shows up after a full page reload.
const invalidateEnrollmentQueries = (queryClient: ReturnType<typeof useQueryClient>) => {
    queryClient.invalidateQueries({ queryKey: ['students'] });
    queryClient.invalidateQueries({ queryKey: ['student-count'] });
    queryClient.invalidateQueries({ queryKey: ['GET_LEARNER_PACKAGES'] });
    queryClient.invalidateQueries({ queryKey: ['user-plans'] });
};

// ── Bulk Assign ──
export const useBulkAssign = () => {
    const queryClient = useQueryClient();

    return useMutation<BulkAssignResponse, Error, BulkAssignRequest>({
        mutationFn: async (request) => {
            const response = await authenticatedAxiosInstance.post<BulkAssignResponse>(
                BULK_ASSIGN_LEARNERS,
                request
            );
            return response.data;
        },
        onSuccess: (_data, request) => {
            // Preview is a dry run — nothing was written.
            if (request.options?.dry_run) return;
            invalidateEnrollmentQueries(queryClient);
        },
    });
};

// ── Bulk De-assign ──
export const useBulkDeassign = () => {
    const queryClient = useQueryClient();

    return useMutation<BulkDeassignResponse, Error, BulkDeassignRequest>({
        mutationFn: async (request) => {
            const response = await authenticatedAxiosInstance.post<BulkDeassignResponse>(
                BULK_DEASSIGN_LEARNERS,
                request
            );
            return response.data;
        },
        onSuccess: (_data, request) => {
            if (request.options?.dry_run) return;
            invalidateEnrollmentQueries(queryClient);
        },
    });
};

// ── List invites for a package session (paginated) ──
export const useInvitesForPackageSession = (
    instituteId: string,
    packageSessionId: string,
    page = 0,
    pageSize = 20,
    enabled = true
) => {
    return useQuery({
        queryKey: ['invites-for-ps', instituteId, packageSessionId, page],
        queryFn: async () => {
            const params = new URLSearchParams({
                instituteId,
                pageNo: String(page),
                pageSize: String(pageSize),
            });
            const response = await authenticatedAxiosInstance.post(
                `${GET_INVITE_LINKS}?${params}`,
                {
                    search_name: null,
                    package_session_ids: [packageSessionId],
                    payment_option_ids: null,
                    sort_columns: { created_at: 'desc' },
                    tags: null,
                }
            );
            return response.data;
        },
        enabled: enabled && !!instituteId && !!packageSessionId,
    });
};

// ── Get full invite details ──
export const useInviteDetails = (
    instituteId: string,
    enrollInviteId: string | null,
    enabled = true
) => {
    return useQuery<EnrollInviteDTO>({
        queryKey: ['invite-detail', instituteId, enrollInviteId],
        queryFn: async () => {
            const url = GET_SINGLE_INVITE_DETAILS.replace('{instituteId}', instituteId).replace(
                '{enrollInviteId}',
                enrollInviteId!
            );
            const response = await authenticatedAxiosInstance.get<EnrollInviteDTO>(url);
            return response.data;
        },
        enabled: enabled && !!enrollInviteId && !!instituteId,
    });
};

// ── Get default invite for a package session ──
export const useDefaultInvite = (
    instituteId: string,
    packageSessionId: string,
    enabled = true
) => {
    return useQuery<EnrollInviteDTO | null>({
        queryKey: ['default-invite', instituteId, packageSessionId],
        queryFn: async () => {
            try {
                const response = await authenticatedAxiosInstance.get<EnrollInviteDTO>(
                    GET_DEFAULT_INVITE(instituteId, packageSessionId)
                );
                return response.data;
            } catch {
                return null; // No default — backend will auto-create
            }
        },
        enabled: enabled && !!instituteId && !!packageSessionId,
    });
};
