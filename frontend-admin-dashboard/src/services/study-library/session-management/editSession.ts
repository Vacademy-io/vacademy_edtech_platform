import { EDIT_SESSION } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateInstituteDetails } from '@/services/student-list-section/getInstituteDetails';

export interface EditSessionRequest {
    comma_separated_hidden_package_session_ids: string;
    session_name: string;
    start_date: string;
    status: string;
    comma_separated_visible_package_session_ids: string;
}

export const useEditSession = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            requestData,
            sessionId,
        }: {
            requestData: EditSessionRequest;
            sessionId: string;
        }) => {
            const payload = requestData;
            return authenticatedAxiosInstance.put(
                `${EDIT_SESSION}?sessionId=${sessionId}`,
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
