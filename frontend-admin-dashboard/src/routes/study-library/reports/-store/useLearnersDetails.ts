import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { GET_LEARNERS_DETAILS } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

// Define the response type
interface User {
    full_name: string;
    user_id: string;
}

// If the response is an array of users
export type UserResponse = User[];

// Fetch function using Axios
const fetchLearnerDetails = async (
    packageSessionId: string,
    instituteId: string
): Promise<UserResponse> => {
    const response = await authenticatedAxiosInstance.get(GET_LEARNERS_DETAILS, {
        params: { packageSessionId, instituteId },
        headers: { accept: '*/*' },
    });
    return response.data;
};

// Custom hook using React Query
export const useLearnerDetails = (packageSessionId: string, instituteId: string) => {
    return useQuery({
        queryKey: ['learnerDetails', packageSessionId, instituteId],
        queryFn: () => fetchLearnerDetails(packageSessionId, instituteId),
        enabled: !!packageSessionId && !!instituteId, // Only run if params are valid
    });
};

/** A learner plus every selected batch they are enrolled in. */
export interface LearnerInBatches {
    user_id: string;
    full_name: string;
    /** package_session_ids (subset of the ids passed to the hook). */
    batchIds: string[];
}

/**
 * Union of the learners across several batches — the picker for the
 * multi-batch Learner reports. The endpoint is per batch, so this fans out one
 * query per id (same cache key as {@link useLearnerDetails}) and merges by
 * user_id, remembering which of the selected batches each learner is in so a
 * report can be generated for exactly those.
 */
export const useLearnerDetailsForBatches = (packageSessionIds: string[], instituteId: string) => {
    const results = useQueries({
        queries: packageSessionIds.map((packageSessionId) => ({
            queryKey: ['learnerDetails', packageSessionId, instituteId],
            queryFn: () => fetchLearnerDetails(packageSessionId, instituteId),
            enabled: !!packageSessionId && !!instituteId,
        })),
    });

    const isLoading = results.some((r) => r.isLoading);
    // useQueries returns a fresh array each render; key off the resolved data.
    const dataKey = results.map((r) => r.dataUpdatedAt).join('|');

    const learners = useMemo<LearnerInBatches[]>(() => {
        const byUser = new Map<string, LearnerInBatches>();
        packageSessionIds.forEach((batchId, index) => {
            (results[index]?.data ?? []).forEach((user) => {
                const existing = byUser.get(user.user_id);
                if (existing) {
                    if (!existing.batchIds.includes(batchId)) existing.batchIds.push(batchId);
                } else {
                    byUser.set(user.user_id, {
                        user_id: user.user_id,
                        // Tolerate a missing name (the old picker only read it on search).
                        full_name: user.full_name ?? '',
                        batchIds: [batchId],
                    });
                }
            });
        });
        return Array.from(byUser.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [packageSessionIds.join('|'), dataKey]);

    return { learners, isLoading };
};
