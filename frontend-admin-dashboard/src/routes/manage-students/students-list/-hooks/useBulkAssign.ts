import { useMutation, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BULK_ASSIGN_LEARNERS } from '@/constants/urls';
import { BulkAssignRequest, BulkAssignResponse } from '../-types/bulk-assign-types';

const bulkAssignLearners = async (request: BulkAssignRequest): Promise<BulkAssignResponse> => {
    const response = await authenticatedAxiosInstance.post<BulkAssignResponse>(
        BULK_ASSIGN_LEARNERS,
        request
    );
    return response.data;
};

export const useBulkAssign = () => {
    const queryClient = useQueryClient();

    return useMutation<BulkAssignResponse, Error, BulkAssignRequest>({
        mutationFn: bulkAssignLearners,
        onSuccess: (_data, request) => {
            // The preview step is a dry run — nothing was written, so there is
            // nothing to refresh.
            if (request.options?.dry_run) return;
            // The learner list is cached for 30s with refetchOnMount off, so
            // without this the newly enrolled learner only appears after a
            // full page reload. Counts and the side-view's per-learner course
            // queries move with the same write.
            queryClient.invalidateQueries({ queryKey: ['students'] });
            queryClient.invalidateQueries({ queryKey: ['student-count'] });
            queryClient.invalidateQueries({ queryKey: ['GET_LEARNER_PACKAGES'] });
            queryClient.invalidateQueries({ queryKey: ['user-plans'] });
        },
    });
};
