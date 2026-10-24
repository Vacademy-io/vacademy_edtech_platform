import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EditStudentDetailsFormValues } from '../-components/students-list/student-side-view/student-overview/EditStudentDetails';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { EDIT_LEARNER_DETAILS } from '@/constants/urls';
import { toast } from 'sonner';
import { useStudentSidebar } from '../-context/selected-student-sidebar-context';
import { getCustomFieldSettingsFromCache } from '@/services/custom-field-settings';

export const useEditStudentDetails = () => {
    const queryClient = useQueryClient();
    const { selectedStudent } = useStudentSidebar();
    const { t } = useTranslation('manageStudentsEditStudentDetailsService');
    return useMutation({
        mutationFn: (data: EditStudentDetailsFormValues) => {
            // Get custom field IDs from cache to distinguish system vs custom fields
            const customFieldSettings = getCustomFieldSettingsFromCache();
            const customFieldIds = new Set(
                customFieldSettings?.customFields?.map((cf) => cf.id) || []
            );

            // Build custom_field_values array (ONLY custom fields, NOT system fields)
            const customFieldValues = data.custom_fields
                ? Object.entries(data.custom_fields)
                    .filter(([fieldId]) => customFieldIds.has(fieldId))
                    .map(([custom_field_id, value]) => ({
                        source_type: "USER",
                        source_id: data.user_id,
                        custom_field_id,
                        value: value || '',
                    }))
                : [];

            // Build the API payload structure
            const payload = {
                user_details: {
                    id: data.user_id,
                    username: data.username || '',
                    email: data.email,
                    full_name: data.full_name,
                    address_line: data.address_line || '',
                    city: data.city || '',
                    region: data.state || '',
                    pin_code: data.pin_code || '',
                    mobile_number: data.contact_number || '',
                    date_of_birth: data.date_of_birth || '',
                    gender: data.gender,
                    profile_pic_file_id: data.face_file_id || '',
                    roles: ['STUDENT'],
                },
                learner_extra_details: {
                    fathers_name: data.fathers_name || '',
                    mothers_name: data.mothers_name || '',
                    parents_mobile_number: data.father_mobile_number || '',
                    parents_email: data.father_email || '',
                    parents_to_mother_mobile_number: data.mother_mobile_number || '',
                    parents_to_mother_email: data.mother_email || '',
                    linked_institute_name: data.institute_name || '',
                },
                custom_field_values: customFieldValues,
            };

            return authenticatedAxiosInstance.put(`${EDIT_LEARNER_DETAILS}`, payload);
        },
        onSuccess: () => {
            toast.success(t('updateSuccess'));
            queryClient.invalidateQueries({ queryKey: ['students'] });
            queryClient.invalidateQueries({
                queryKey: ['GET_USER_CREDENTIALS', selectedStudent?.user_id || ''],
            });
        },
        onError: () => {
            toast.error(t('updateError'));
        },
    });
};
