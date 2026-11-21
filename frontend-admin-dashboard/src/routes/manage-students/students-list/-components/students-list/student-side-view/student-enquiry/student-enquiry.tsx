import { ClipboardText } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_AUDIENCE_LEAD_BY_RESPONSE_ID, GET_USER_LEAD_PROFILE } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { EnquiryDetails } from '@/routes/admissions/enquiries/-components/enquiry-side-view/enquiry-details';
import { ProfileEmpty } from '../profile-ui';

interface StudentEnquiryProps {
    /** Set when the side view is opened from Admissions → Enquiries. */
    enquiryId?: string | null;
    /**
     * The learner. From Manage Students no enquiry id is passed, so the enquiry is
     * looked up through the learner's lead profile (its best response → enquiry).
     */
    userId?: string | null;
}

/**
 * Learner → enquiry id: the lead profile names the learner's best response,
 * and that response carries the enquiry. Null when the learner never enquired
 * (or the lead system has no profile for them).
 */
async function resolveStudentEnquiryId(
    userId: string,
    instituteId: string
): Promise<string | null> {
    let responseId: string | null = null;
    try {
        const profile = await authenticatedAxiosInstance.get<{
            best_score_response_id?: string | null;
        }>(GET_USER_LEAD_PROFILE, { params: { userId, instituteId } });
        responseId = profile.data?.best_score_response_id ?? null;
    } catch {
        return null; // 404 = no lead profile for this learner
    }
    if (!responseId) return null;
    const lead = await authenticatedAxiosInstance.get<{ enquiry_id?: string | null }>(
        GET_AUDIENCE_LEAD_BY_RESPONSE_ID(responseId)
    );
    return lead.data?.enquiry_id ?? null;
}

export const StudentEnquiry = ({ enquiryId, userId }: StudentEnquiryProps) => {
    const { t } = useTranslation('manageStudentsStudentEnquiry');
    const instituteId = getCurrentInstituteId();

    const { data: resolvedEnquiryId, isLoading } = useQuery({
        queryKey: ['student-enquiry-id', instituteId, userId],
        queryFn: () => resolveStudentEnquiryId(userId as string, instituteId as string),
        enabled: !enquiryId && !!userId && !!instituteId,
        staleTime: 5 * 60 * 1000,
    });

    const id = enquiryId || resolvedEnquiryId;

    if (!id && isLoading) {
        return (
            <div className="flex justify-center py-10">
                <DashboardLoader />
            </div>
        );
    }

    if (!id) {
        return (
            <ProfileEmpty
                icon={ClipboardText}
                title={t('noEnquiryFound.title')}
                hint={t('noEnquiryFound.hint')}
            />
        );
    }

    return <EnquiryDetails enquiryId={id} />;
};
