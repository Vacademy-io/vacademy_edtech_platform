import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_DOUBT_BY_ID } from '@/constants/urls';
import { DoubtActivity } from '../-types/doubt-activity';

export const DOUBT_ACTIVITY_QUERY_KEY = 'GET_DOUBT_ACTIVITY';

/** Audit trail of one doubt (assignments, status changes, remarks), oldest first. Staff only. */
export const useDoubtActivity = (doubtId?: string | null, options?: { enabled?: boolean }) =>
    useQuery({
        queryKey: [DOUBT_ACTIVITY_QUERY_KEY, doubtId],
        queryFn: async (): Promise<DoubtActivity[]> => {
            if (!doubtId) return [];
            const response = await authenticatedAxiosInstance.get<DoubtActivity[]>(
                `${GET_DOUBT_BY_ID}/${doubtId}/activity`
            );
            return Array.isArray(response.data) ? response.data : [];
        },
        enabled: !!doubtId && options?.enabled !== false,
        staleTime: 15_000,
    });
