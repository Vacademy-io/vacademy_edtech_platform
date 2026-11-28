// services/study-library/course-operations/update-course.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateInstituteDetails } from '@/services/student-list-section/getInstituteDetails';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CourseFormData } from '@/components/common/study-library/add-course/add-course-form';
import { UPDATE_COURSE } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';

export const useUpdateCourse = () => {
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();

    return useMutation({
        mutationFn: async ({ requestData }: { requestData: CourseFormData }) => {
            return authenticatedAxiosInstance.post(
                `${UPDATE_COURSE}/${instituteId}?instituteId=${instituteId}`,
                requestData
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['GET_INIT_STUDY_LIBRARY'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_SESSION_DATA'] });
            queryClient.invalidateQueries({ queryKey: ['GET_BATCHES'] });
            // Package sessions changed: refresh the institute-details store too.
            invalidateInstituteDetails(queryClient);
        },
    });
};
