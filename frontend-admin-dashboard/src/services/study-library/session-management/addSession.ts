import { AddSessionDataType } from '@/routes/manage-institute/sessions/-components/session-operations/add-session/add-session-form';
import { ADD_SESSION } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateInstituteDetails } from '@/services/student-list-section/getInstituteDetails';
import { getInstituteId } from '@/constants/helper';

export const useAddSession = () => {
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();

    return useMutation({
        mutationFn: async ({ requestData }: { requestData: AddSessionDataType }) => {
            const payload = requestData;
            return authenticatedAxiosInstance.post(
                `${ADD_SESSION}?instituteId=${instituteId}`,
                payload
            );
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
