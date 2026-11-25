import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CHECK_USERNAME_AVAILABILITY } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export interface UsernameAvailabilityInput {
    username: string;
    email?: string;
    mobile_number?: string;
}

/**
 * Whether a username typed for a NEW learner is free. It also counts as free when it
 * already belongs to this same learner (the email or phone typed is the one on that
 * account). The email and phone go in the body so they stay out of access logs.
 */
export const checkUsernameAvailability = async (
    input: UsernameAvailabilityInput
): Promise<boolean> => {
    const response = await authenticatedAxiosInstance.post<{ available?: boolean }>(
        CHECK_USERNAME_AVAILABILITY,
        {
            username: input.username,
            email: input.email || undefined,
            mobile_number: input.mobile_number || undefined,
        },
        { params: { instituteId: getCurrentInstituteId() } }
    );
    return response.data?.available !== false;
};
