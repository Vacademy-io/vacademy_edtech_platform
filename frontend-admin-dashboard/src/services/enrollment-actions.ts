import axios from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    ENROLL_LEARNER_V2,
    ENROLL_LEARNER_V2_ADMIN,
    CANCEL_USER_PLAN,
    PACKAGE_AUTOCOMPLETE_URL,
    GET_STUDENTS,
} from '@/constants/urls';

export interface EnrollmentItem {
    package_session_id: string;
    plan_id: string;
    payment_option_id: string;
    enroll_invite_id: string;
}

export interface EnrollRequestV2 {
    userId: string;
    institute_id: string;
    enrollmentType: string;
    learner_package_session_enrollments: EnrollmentItem[];
}

/**
 * Fetch detailed package session info (hacky way to get plan/payment details via student list API)
 */
export const fetchPackageSessionDetails = async (packageSessionIds: string[], instituteId: string) => {
    // Determine status to fetch - usually ACTIVE is enough to find a valid session config
    // We send a filter request similar to the one in the prompt
    const payload = {
        name: "",
        institute_ids: [instituteId],
        package_session_ids: packageSessionIds,
        statuses: ["ACTIVE", "INACTIVE"], // As per prompt
        group_ids: [],
        gender: [],
        session_expiry_days: [],
        sort_columns: {},
        sub_org_user_types: [],
        payment_statuses: [],
        sources: [],
        types: [],
        type_ids: [],
        destination_package_session_ids: [],
        level_ids: []
    };

    const response = await authenticatedAxiosInstance.post(
        `${GET_STUDENTS}?pageNo=0&pageSize=${Math.max(10, packageSessionIds.length * 5)}`, // Fetch enough to likely hit matches
        payload
    );
    return response.data;
};

/**
 * Whether the server has no handler for the request's route. Admin-core forwards an
 * unknown route to Spring's /error page, which the security filter refuses (ACCESS_DENIED
 * on path "/error"), so it carries none of our own `ex` error body.
 */
const isUnknownRoute = (error: unknown): boolean => {
    if (!axios.isAxiosError(error) || !error.response) return false;
    const data = error.response.data as { path?: string; ex?: string } | undefined;
    return [403, 404, 405].includes(error.response.status) && data?.path === '/error' && !data?.ex;
};

/**
 * Enroll a learner into a book/membership (Rent/Buy/Purchase).
 *
 * Goes to the admin-only endpoint. An admin-core deployed before that endpoint existed
 * doesn't know the route, and still takes MANUAL enrollments on the public one, so retry
 * there. Deploy the dashboard first: the new admin-core refuses MANUAL on the public
 * endpoint, so this retry can never get past its admin check. Remove the fallback once
 * the admin-only endpoint is live everywhere.
 */
export const enrollLearnerV2 = async (payload: EnrollRequestV2) => {
    try {
        const response = await authenticatedAxiosInstance.post(ENROLL_LEARNER_V2_ADMIN, payload);
        return response.data;
    } catch (error) {
        if (!isUnknownRoute(error)) throw error;
        const response = await authenticatedAxiosInstance.post(ENROLL_LEARNER_V2, payload);
        return response.data;
    }
};

/**
 * Cancel a user plan (Return book / End membership)
 */
export const cancelUserPlan = async (user_plan_id: string, force: boolean = true) => {
    const response = await authenticatedAxiosInstance.put(CANCEL_USER_PLAN(user_plan_id), null, {
        params: { force },
    });
    return response.data;
};

/**
 * Autosuggest packages for enrollment search
 */
export const searchPackages = async (
    query: string,
    instituteId: string,
    params?: {
        session_id?: string;
        level_id?: string;
        packageType?: string;
    }
) => {
    const response = await authenticatedAxiosInstance.get(PACKAGE_AUTOCOMPLETE_URL, {
        params: {
            q: query,
            instituteId: instituteId,
            ...(params?.session_id && { session_id: params.session_id }),
            ...(params?.level_id && { level_id: params.level_id }),
            ...(params?.packageType && { package_type: params.packageType }),
        },
    });
    return response.data;
};
