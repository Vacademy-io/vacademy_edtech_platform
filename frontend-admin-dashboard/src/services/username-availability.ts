import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CHECK_USERNAME_AVAILABILITY } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export interface UsernameAvailabilityInput {
    username: string;
    email?: string;
    mobile_number?: string;
}

export interface UsernameAvailability {
    /** The admin may use this username for the learner being added. */
    available: boolean;
    /** It belongs to a learner already in this institute: that learner will be enrolled. */
    existingLearner: boolean;
}

/**
 * Whether a username typed for a learner being added may be used. Same rule as the add
 * itself: free, a learner already in this institute, or the same person (the email or
 * phone typed matches that account) → allowed; anyone else → taken. The email and phone
 * go in the body so they stay out of access logs.
 */
export const checkUsernameAvailability = async (
    input: UsernameAvailabilityInput
): Promise<UsernameAvailability> => {
    const response = await authenticatedAxiosInstance.post<{
        available?: boolean;
        existing_learner?: boolean;
    }>(
        CHECK_USERNAME_AVAILABILITY,
        {
            username: input.username,
            email: input.email || undefined,
            mobile_number: input.mobile_number || undefined,
        },
        { params: { instituteId: getCurrentInstituteId() } }
    );
    return {
        available: response.data?.available !== false,
        existingLearner: response.data?.existing_learner === true,
    };
};
