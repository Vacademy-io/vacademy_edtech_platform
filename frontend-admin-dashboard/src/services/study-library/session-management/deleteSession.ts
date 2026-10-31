import { DELETE_SESSION } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateInstituteDetails } from '@/services/student-list-section/getInstituteDetails';

export const useDeleteSession = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ requestData }: { requestData: string[] }) => {
            return authenticatedAxiosInstance.delete(DELETE_SESSION, { data: requestData });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['GET_INIT_STUDY_LIBRARY'] });
            queryClient.invalidateQueries({ queryKey: ['GET_SESSION_DATA'] });
            queryClient.invalidateQueries({ queryKey: ['GET_BATCHES'] });
            // Package sessions changed: refresh the institute-details store too.
            invalidateInstituteDetails(queryClient);
        },
    });
};
