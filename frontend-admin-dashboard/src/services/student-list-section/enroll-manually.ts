// services/api/studentApi.ts
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ENROLL_STUDENT_MANUALLY } from '@/constants/urls';
import { EnrollStudentRequest } from '@/types/students/type-enroll-student-manually';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getCustomFieldSettingsFromCache } from '@/services/custom-field-settings';
import { getSelectedSubOrgId } from '@/lib/auth/facultyAccessUtils';
import { toAdminDiscountPayload } from '@/services/admin-discounts';

type EnrollStudentResponse = string;

export const enrollStudent = async ({
    formData,
}: EnrollStudentRequest): Promise<EnrollStudentResponse> => {
    try {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const tokenData = getTokenDecodedData(accessToken);

        if (!tokenData || !tokenData.authorities) {
            throw new Error('Invalid token: Missing authorities');
        }

        const instituteIds = Object.keys(tokenData.authorities);
        if (instituteIds.length === 0) {
            throw new Error('No institute ID found in token');
        }

        const INSTITUTE_ID = instituteIds[0];

        // Get custom field IDs from cache to distinguish system vs custom fields
        const customFieldSettings = getCustomFieldSettingsFromCache();
        const customFieldIds = new Set(customFieldSettings?.customFields?.map((cf) => cf.id) || []);

        // Build custom_field_values array (ONLY custom fields, NOT system fields)
        const customFieldValues = formData.stepTwoData?.custom_fields
            ? Object.entries(formData.stepTwoData.custom_fields)
                .filter(([fieldId]) => customFieldIds.has(fieldId))
                .map(([custom_field_id, value]) => ({
                    custom_field_id,
                    value,
                }))
            : [];

        // Build payment_initiation_request
        const paymentInitiationRequest = {
            amount: parseFloat(formData.stepFourData?.amount || '0'),
            currency: formData.stepFourData?.currency || 'INR',
            manual_request: {
                file_id: formData.stepFourData?.file_id || undefined,
                transaction_id: formData.stepFourData?.transaction_id || undefined,
            },
        };

        // Build learner_extra_details object with parent/guardian fields
        const learnerExtraDetails = {
            fathers_name: formData.stepTwoData?.fathers_name || undefined,
            mothers_name: formData.stepTwoData?.mothers_name || undefined,
            parents_mobile_number: formData.stepTwoData?.parents_mobile_number || undefined,
            parents_email: formData.stepTwoData?.parents_email || undefined,
            parents_to_mother_mobile_number:
                formData.stepTwoData?.parents_to_mother_mobile_number || undefined,
            parents_to_mother_email: formData.stepTwoData?.parents_to_mother_email || undefined,
            linked_institute_name: formData.stepTwoData?.linked_institute_name || undefined,
        };

        // Build the NEW API payload structure matching guide.md EXACTLY
        const requestBody = {
            user: {
                full_name: formData.stepTwoData?.full_name || '',
                email: formData.stepTwoData?.email || '',
                mobile_number: formData.stepTwoData?.mobile_number || '',
                username: formData.stepFiveData?.username || '',
                password: formData.stepFiveData?.password || '',
                gender: formData.stepTwoData?.gender || undefined,
                date_of_birth: formData.stepTwoData?.date_of_birth || undefined,
                roles: ['STUDENT'],
            },
            institute_id: INSTITUTE_ID,
            learner_package_session_enroll: {
                package_session_ids: formData.stepThreeData?.invite?.package_session_ids || [],
                enroll_invite_id: formData.stepThreeData?.invite?.id || '',
                payment_option_id: formData.stepThreeData?.invite?.payment_option_id || '',
                plan_id: formData.stepFourData?.plan_id || undefined,
                payment_initiation_request: paymentInitiationRequest,
                // Admin-granted discount (ONE_TIME / SUBSCRIPTION only). Omitted when "No
                // discount" — the backend then charges the plan price as before.
                admin_discount: toAdminDiscountPayload(formData.stepFourData?.admin_discount, {
                    includeCycles:
                        (formData.stepThreeData?.invite?.payment_option_type || '').toUpperCase() ===
                        'SUBSCRIPTION',
                }),
                custom_field_values: customFieldValues,
                start_date: formData.stepThreeData?.start_date || new Date().toISOString(),
                // Admin-entered override. Sent only when it is a real positive number, so
                // a blank field falls back to the plan's validity and then the invite's,
                // rather than being read as "zero days of access".
                access_days: (() => {
                    const days = parseInt(formData.stepThreeData?.access_days ?? '', 10);
                    return Number.isFinite(days) && days > 0 ? days : undefined;
                })(),
            },
            learner_extra_details: learnerExtraDetails,
            sub_org_id: getSelectedSubOrgId() || undefined,
        };

        const response = await authenticatedAxiosInstance.post(
            ENROLL_STUDENT_MANUALLY,
            requestBody
        );
        return response.data;
    } catch (error: unknown) {
        const err = error as { message?: string; response?: { data?: { message?: string } } };
        console.error('[EnrollStudent Error]', err?.message || error);
        throw new Error(err?.response?.data?.message || 'Failed to enroll student.');
    }
};
