import { AddLevelData } from '@/routes/study-library/courses/course-details/-components/add-course-details-form';
import { ADD_LEVEL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateInstituteDetails } from '@/services/student-list-section/getInstituteDetails';
import { getInstituteId } from '@/constants/helper';

export const useAddLevel = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            requestData,
            packageId,
            sessionId,
        }: {
            requestData: AddLevelData;
            packageId: string;
            sessionId: string;
        }) => {
            const payload = requestData;
            const instituteId = getInstituteId();
            return authenticatedAxiosInstance.post(
                `${ADD_LEVEL}?packageId=${packageId}&sessionId=${sessionId}&instituteId=${instituteId}`,
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
