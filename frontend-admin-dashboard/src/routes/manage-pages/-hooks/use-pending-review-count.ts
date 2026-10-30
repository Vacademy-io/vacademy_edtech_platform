import { useQuery } from '@tanstack/react-query';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { listSiteReviews } from '../-services/review-service';

/**
 * Reviews waiting for approval, for the badge on the Reviews buttons. The key
 * sits under the Reviews list's prefix, so approving or rejecting there
 * refreshes it; it also re-reads every minute while the builder is open.
 */
export const usePendingReviewCount = (): number => {
    const instituteId = getCurrentInstituteId();
    const { data } = useQuery({
        queryKey: ['catalogue-site-reviews', instituteId, 'pending-count'],
        queryFn: () => listSiteReviews(instituteId!, { status: 'PENDING', page: 0, size: 1 }),
        enabled: !!instituteId,
        staleTime: 30_000,
        refetchInterval: 60_000,
        refetchOnWindowFocus: true,
        // A badge is not worth retries: a failed read just shows no count until the next poll.
        retry: false,
    });
    return data?.counts?.PENDING ?? 0;
};

/** "99+" past two digits, so the badge stays a dot-sized pill. */
export const formatBadgeCount = (n: number): string => (n > 99 ? '99+' : String(n));
