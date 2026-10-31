import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { invalidateInstituteDetails } from '@/services/student-list-section/getInstituteDetails';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { DELETE_BATCHES } from '@/constants/urls';
export const useDeleteBatches = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ packageSessionIds }: { packageSessionIds: string[] }) => {
            return authenticatedAxiosInstance.delete(`${DELETE_BATCHES}`, {
                data: packageSessionIds,
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['GET_INIT_STUDY_LIBRARY'] });
            invalidateInstituteDetails(queryClient);
            queryClient.invalidateQueries({ queryKey: ['students'] });
            queryClient.invalidateQueries({ queryKey: ['GET_SESSION_DATA'] });
            queryClient.invalidateQueries({ queryKey: ['GET_BATCHES'] });
        },
    });
};
