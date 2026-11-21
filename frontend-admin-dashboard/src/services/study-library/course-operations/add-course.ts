import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateInstituteDetails } from '@/services/student-list-section/getInstituteDetails';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ADD_COURSE } from '@/constants/urls';
import { CourseFormData } from '@/components/common/study-library/add-course/add-course-form';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export const useAddCourse = () => {
    const INSTITUTE_ID = getCurrentInstituteId();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ requestData }: { requestData: CourseFormData }) => {
            const payload = requestData;

            return authenticatedAxiosInstance.post(`${ADD_COURSE}/${INSTITUTE_ID}`, payload);
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
