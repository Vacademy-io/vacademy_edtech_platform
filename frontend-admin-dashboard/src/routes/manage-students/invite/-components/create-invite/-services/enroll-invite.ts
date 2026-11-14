import { ENROLL_INVITE_URL, GET_SINGLE_INVITE_DETAILS, UPDATE_INVITE_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { convertInviteData, PaymentOption, ReferralData } from '../-utils/helper';
import { getInstituteId } from '@/constants/helper';
import type { IndividualInviteLinkDetails } from '@/types/study-library/individual-invite-interface';

export interface Course {
    id: string;
    name: string;
}

export interface Batch {
    sessionId: string;
    levelId: string;
    sessionName: string;
    levelName: string;
    courseId: string;
    courseName: string;
    isParent?: boolean;
}

export const handleEnrollInvite = async ({
    data,
    selectedCourse,
    selectedBatches,
    getPackageSessionId,
    paymentsData,
    referralProgramDetails,
    instituteLogoFileId,
    inviteId,
    instituteVendor,
    existingInviteDetails,
}: {
    data: InviteLinkFormValues;
    selectedCourse: Course | null;
    selectedBatches: Batch[];
    getPackageSessionId: ({
        courseId,
        levelId,
        sessionId,
    }: {
        courseId: string;
        levelId: string;
        sessionId: string;
    }) => void;
    paymentsData: PaymentOption[];
    referralProgramDetails: ReferralData[];
    instituteLogoFileId: string;
    inviteId?: string;
    instituteVendor?: { vendor: string; vendor_id: string } | null;
    /**
     * The invite being updated, when there is one. convertInviteData reads it to preserve
     * fields the caller's form does not own — vendor, currency and any setting_json keys
     * set outside this form. Callers that build an invite from scratch omit it.
     */
    existingInviteDetails?: IndividualInviteLinkDetails | null;
}) => {
    const convertedData = convertInviteData(
        data,
        selectedCourse,
        selectedBatches,
        getPackageSessionId,
        paymentsData,
        referralProgramDetails,
        instituteLogoFileId,
        inviteId,
        existingInviteDetails ?? null,
        instituteVendor
    );

    // Create and update are different ROUTES, not just different verbs. EnrollInviteController
    // maps create to the controller root (@PostMapping) but update to
    // @PutMapping("/enroll-invite") -- i.e. /v1/enroll-invite/enroll-invite. A PUT to the root
    // matches no handler, so Spring forwards to /error, which is itself protected, and the auth
    // entry point answers 403 ACCESS_DENIED. That reads like a permissions problem but is really
    // a 404, so don't "fix" it by touching the security config.
    const response = await authenticatedAxiosInstance({
        method: inviteId ? 'PUT' : 'POST',
        url: inviteId ? UPDATE_INVITE_URL : ENROLL_INVITE_URL,
        data: convertedData,
    });
    return response?.data;
};

export const getEnrollSingleInviteDetails = async ({ inviteId }: { inviteId: string }) => {
    const instituteId = getInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_SINGLE_INVITE_DETAILS.replace('{instituteId}', instituteId || '').replace(
            '{enrollInviteId}',
            inviteId
        ),
        params: {
            instituteId,
            enrollInviteId: inviteId,
        },
    });
    return response?.data;
};
export const handleGetEnrollSingleInviteDetails = ({ inviteId }: { inviteId: string }) => {
    return {
        queryKey: ['GET_SINGLE_INVITE_DETAILS', inviteId],
        queryFn: () => getEnrollSingleInviteDetails({ inviteId }),
        staleTime: 60 * 60 * 1000,
    };
};
