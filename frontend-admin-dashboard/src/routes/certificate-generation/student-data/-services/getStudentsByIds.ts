import { GET_USER_DETAILS } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import i18n from '@/i18n';
import { CertificateStudentData } from '@/types/certificate/certificate-types';

const NS = 'certificateGenerationGetStudentsByIds';

export interface RawStudentDetailsResponse {
    id: string;
    username: string;
    email: string;
    full_name: string;
    address_line: string;
    region: string | null;
    city: string;
    pin_code: string;
    mobile_number: string;
    date_of_birth: string;
    gender: string;
    fathers_name?: string;
    mothers_name?: string;
    parents_mobile_number?: string;
    parents_email?: string;
    linked_institute_name?: string;
    created_at?: string;
    updated_at?: string;
    package_session_id?: string;
    institute_enrollment_id?: string;
    status?: 'ACTIVE' | 'TERMINATED' | 'INACTIVE';
    session_expiry_days?: number;
    institute_id?: string;
    country?: string;
    expiry_date?: number;
    face_file_id?: string | null;
    parents_to_mother_mobile_number?: string;
    parents_to_mother_email?: string;
}

export const fetchStudentDetailsByIds = async (
    userIds: string[]
): Promise<CertificateStudentData[]> => {
    console.log('🔍 Fetching student details for IDs:', userIds);

    try {
        // Fetch all students in parallel
        const promises = userIds.map(async (userId) => {
            const response = await authenticatedAxiosInstance.get<RawStudentDetailsResponse>(
                GET_USER_DETAILS,
                {
                    params: { userId },
                }
            );

            console.log(
                `✅ Fetched data for ${userId}: ${response.data.full_name} (${response.data.email})`
            );

            // Transform the raw response to match CertificateStudentData interface
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            const studentData: CertificateStudentData = {
                id: response.data.id || userId,
                user_id: userId,
                username: response.data.username || null,
                email: response.data.email || '',
                full_name: response.data.full_name || '',
                address_line: response.data.address_line || '',
                region: response.data.region || null,
                city: response.data.city || '',
                pin_code: response.data.pin_code || '',
                mobile_number: response.data.mobile_number || '',
                date_of_birth: response.data.date_of_birth || '',
                gender: response.data.gender || '',
                fathers_name: response.data.fathers_name || '',
                mothers_name: response.data.mothers_name || '',
                father_mobile_number: response.data.parents_mobile_number || '',
                father_email: response.data.parents_email || '',
                mother_mobile_number: response.data.parents_to_mother_mobile_number || '',
                mother_email: response.data.parents_to_mother_email || '',
                parents_mobile_number: response.data.parents_mobile_number || '',
                parents_email: response.data.parents_email || '',
                linked_institute_name: response.data.linked_institute_name || null,
                created_at: response.data.created_at || new Date().toISOString(),
                updated_at: response.data.updated_at || new Date().toISOString(),
                package_session_id: response.data.package_session_id || '',
                institute_enrollment_id: response.data.institute_enrollment_id || '',
                status: response.data.status || 'ACTIVE',
                session_expiry_days: response.data.session_expiry_days || 365,
                institute_id: response.data.institute_id || '',
                country: response.data.country || '',
                expiry_date: response.data.expiry_date || Date.now() + 365 * 24 * 60 * 60 * 1000,
                face_file_id: response.data.face_file_id || null,
                parents_to_mother_mobile_number:
                    response.data.parents_to_mother_mobile_number || '',
                parents_to_mother_email: response.data.parents_to_mother_email || '',
            };

            return studentData;
        });

        const results = await Promise.all(promises);
        console.log('✅ All student details fetched successfully:', results);

        return results;
    } catch (error) {
        console.error('❌ Error fetching student details:', error);
        throw new Error(
            i18n.t(`${NS}:errors.fetchFailed`, {
                message:
                    error instanceof Error ? error.message : i18n.t(`${NS}:errors.unknownError`),
            })
        );
    }
};
