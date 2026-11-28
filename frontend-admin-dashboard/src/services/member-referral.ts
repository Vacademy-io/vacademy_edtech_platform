import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_MEMBER_REFERRAL } from '@/constants/urls';

/** A person this member referred. snake_case: it is the API shape. */
export interface ReferredFriend {
    user_id: string;
    full_name: string | null;
    email: string | null;
    mobile_number: string | null;
    /** PENDING until the friend makes their first real payment, then ACTIVE. */
    status: 'PENDING' | 'ACTIVE' | string;
    referred_at: string | null;
}

export interface MemberReferral {
    /**
     * NO_REFERRAL_COURSE when none of the member's courses is sold through an invite with a
     * referral programme: nothing else is filled and the profile shows nothing.
     */
    unavailable_reason: 'NO_REFERRAL_COURSE' | null;
    referral_code: string | null;
    short_referral_link: string | null;
    referral_link: string | null;
    invite_id: string | null;
    invite_name: string | null;
    /** Invites the link can be switched to: those selling the member's courses with a referral programme. */
    invites: { id: string; name: string }[];
    referrals: ReferredFriend[];
    rewards_pending: number;
    rewards_ready: number;
    rewards_used: number;
}

export const memberReferralQueryKey = (userId: string, instituteId: string, inviteId?: string) =>
    ['member-referral', userId, instituteId, inviteId ?? ''] as const;

/**
 * One member's referral code, a shareable link for an invite, who they referred and their
 * rewards. The first call for a member who has no code yet creates one, exactly as sending
 * them an announcement with a referral link would.
 */
export const fetchMemberReferral = async (
    userId: string,
    instituteId: string,
    enrollInviteId?: string
): Promise<MemberReferral> => {
    const response = await authenticatedAxiosInstance.get<MemberReferral>(GET_MEMBER_REFERRAL, {
        params: { instituteId, userId, enrollInviteId: enrollInviteId || undefined },
    });
    return response.data;
};
