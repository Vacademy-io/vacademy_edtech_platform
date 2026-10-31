import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_USER_UTM_ATTRIBUTION } from '@/constants/urls';

/** One recorded campaign touch for a learner. snake_case: it is the API shape. */
export interface UtmAttributionRecord {
    id: string;
    source_type: string;
    source_id: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    referrer_host: string | null;
    landing_path: string | null;
    created_at: string | null;
}

export const utmAttributionQueryKey = (
    userId: string,
    instituteId: string,
    email?: string,
    mobileNumber?: string
) => ['utm-attribution', userId, instituteId, email ?? '', mobileNumber ?? ''] as const;

/**
 * Every campaign touch recorded for one learner, oldest first.
 *
 * Resolves to an empty array on failure rather than rejecting: this powers an
 * informational card on a profile that must keep rendering. Most learners have
 * no attribution at all — they arrived before the feature existed, or on an
 * untagged link — so "nothing here" is the normal case, not an error state.
 */
export const fetchUtmAttributionForUser = async (
    userId: string,
    instituteId: string,
    email?: string,
    mobileNumber?: string
): Promise<UtmAttributionRecord[]> => {
    // Email/mobile are sent alongside the user id because three of the six
    // capture surfaces (audience form, live session, catalogue) never learn an
    // auth user id at submit time — their rows carry only the contact details
    // the visitor typed. Matching on user id alone left those touches
    // permanently invisible, which is precisely the lead-generation traffic
    // this feature exists to measure.
    if (!instituteId || (!userId && !email && !mobileNumber)) return [];
    try {
        const response = await authenticatedAxiosInstance.get<UtmAttributionRecord[]>(
            `${GET_USER_UTM_ATTRIBUTION}/${encodeURIComponent(userId || 'unknown')}`,
            {
                params: {
                    instituteId,
                    email: email || undefined,
                    mobileNumber: mobileNumber || undefined,
                },
            }
        );
        return Array.isArray(response.data) ? response.data : [];
    } catch {
        return [];
    }
};
