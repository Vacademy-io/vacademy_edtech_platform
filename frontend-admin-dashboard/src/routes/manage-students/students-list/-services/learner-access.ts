import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CHANGE_LEARNER_ACCESS, GET_LEARNER_ACCESS_HISTORY } from '@/constants/urls';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * How the admin wants the access window changed. Exactly one is sent per request —
 * the backend rejects a payload carrying more than one, since the outcome would be
 * ambiguous.
 */
export type AccessChangeMode = 'extend' | 'set_from_enrollment' | 'set_date' | 'unlimited';

export interface LearnerAccessChangeRequest {
    institute_id: string;
    user_ids: string[];
    package_session_ids?: string[];
    extend_by_days?: number;
    access_days_from_enrollment?: number;
    new_expiry_date?: string;
    /** Move the learner's join date (enrolment date). Independent of the expiry fields. */
    new_join_date?: string;
    /** Whether the plan's term and next charge follow the join date. Defaults to true. */
    shift_plan_window?: boolean;
    make_unlimited?: boolean;
    extend_from_today?: boolean;
    reactivate_expired?: boolean;
    reason?: string;
    dry_run?: boolean;
}

export interface LearnerAccessChangeItem {
    user_id: string;
    learner_name: string | null;
    package_session_id: string | null;
    mapping_id: string | null;
    status: 'UPDATED' | 'SKIPPED' | 'FAILED';
    action: string | null;
    previous_expiry_date: string | null;
    new_expiry_date: string | null;
    previous_join_date?: string | null;
    new_join_date?: string | null;
    new_plan_end_date?: string | null;
    days_delta: number | null;
    /** Days left after the change; null means unlimited. */
    remaining_days: number | null;
    message: string | null;
}

export interface LearnerAccessChangeResponse {
    dry_run: boolean;
    summary: {
        total_targeted: number;
        updated: number;
        skipped: number;
        failed: number;
    };
    results: LearnerAccessChangeItem[];
}

export interface LearnerAccessLogEntry {
    id: string;
    user_id: string;
    package_session_id: string | null;
    mapping_id: string | null;
    source: string;
    action: string;
    previous_expiry_date: string | null;
    new_expiry_date: string | null;
    previous_join_date?: string | null;
    new_join_date?: string | null;
    new_plan_end_date?: string | null;
    days_delta: number | null;
    access_days: number | null;
    user_plan_id: string | null;
    payment_plan_id: string | null;
    enroll_invite_id: string | null;
    reason: string | null;
    actor_id: string | null;
    actor_name: string | null;
    created_at: string;
}

/**
 * Spring's Page envelope is camelCase while the DTO inside it is snake_case —
 * reading total_elements here would render a full list as empty.
 */
export interface LearnerAccessHistoryResponse {
    content: LearnerAccessLogEntry[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
    last: boolean;
    first: boolean;
    empty: boolean;
}

/** Builds the one-of payload the backend expects from the dialog's mode + value. */
export const buildAccessChangePayload = ({
    mode,
    days,
    expiryDate,
}: {
    mode: AccessChangeMode;
    days?: number;
    expiryDate?: string;
}): Pick<
    LearnerAccessChangeRequest,
    'extend_by_days' | 'access_days_from_enrollment' | 'new_expiry_date' | 'make_unlimited'
> => {
    switch (mode) {
        case 'extend':
            return { extend_by_days: days };
        case 'set_from_enrollment':
            return { access_days_from_enrollment: days };
        case 'set_date':
            return { new_expiry_date: expiryDate };
        case 'unlimited':
            return { make_unlimited: true };
    }
};

export const changeLearnerAccess = async (
    request: LearnerAccessChangeRequest
): Promise<LearnerAccessChangeResponse> => {
    const response = await authenticatedAxiosInstance.post(CHANGE_LEARNER_ACCESS, request);
    return response.data;
};

export const useChangeLearnerAccessMutation = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: changeLearnerAccess,
        onSuccess: (data) => {
            // A dry-run preview changed nothing, so leaving the caches alone avoids a
            // refetch storm while the admin is still adjusting the numbers.
            if (data.dry_run) return;
            queryClient.invalidateQueries({ queryKey: ['GET_LEARNER_PACKAGES'] });
            queryClient.invalidateQueries({ queryKey: ['GET_LEARNER_ACCESS_HISTORY'] });
        },
    });
};

export const useLearnerAccessHistoryQuery = ({
    instituteId,
    userId,
    packageSessionIds = [],
    page = 0,
    size = 20,
    enabled = true,
}: {
    instituteId: string;
    userId: string;
    packageSessionIds?: string[];
    page?: number;
    size?: number;
    enabled?: boolean;
}) => {
    return useQuery<LearnerAccessHistoryResponse>({
        queryKey: [
            'GET_LEARNER_ACCESS_HISTORY',
            instituteId,
            userId,
            packageSessionIds,
            page,
            size,
        ],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get(GET_LEARNER_ACCESS_HISTORY, {
                params: {
                    instituteId,
                    userId,
                    page,
                    size,
                    ...(packageSessionIds.length
                        ? { packageSessionIds: packageSessionIds.join(',') }
                        : {}),
                },
            });
            return response.data;
        },
        enabled: enabled && Boolean(instituteId) && Boolean(userId),
    });
};
