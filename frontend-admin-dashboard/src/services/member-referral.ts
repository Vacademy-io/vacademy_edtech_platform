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
    /** Why there is no code or link. Null when there is one. */
    unavailable_reason: 'NOT_A_MEMBER' | 'NO_INVITE' | null;
    referral_code: string | null;
    short_referral_link: string | null;
    referral_link: string | null;
    invite_id: string | null;
    invite_name: string | null;
    /** False when the chosen invite has no referral programme: the code would not apply there. */
    invite_has_referral_program: boolean;
    /** Invites the link can be switched to (those with a referral programme attached). */
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
