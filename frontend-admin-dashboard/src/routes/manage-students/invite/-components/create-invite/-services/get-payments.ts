import { getInstituteId } from '@/constants/helper';
import { GET_PAYMENTS_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

/**
 * How many options a picker asks for at a time.
 *
 * The endpoint used to return the institute's whole list. For one institute that
 * is 6,665 options left by a payments migration — a 5.9 MB response every time a
 * plan picker opened. Searching now happens server-side, so a page this size is
 * plenty to choose from and the rest is one keystroke away.
 */
export const PAYMENT_OPTIONS_PAGE_SIZE = 50;

export const getPaymentDetail = async (search?: string, limit?: number) => {
    const instituteId = getInstituteId();
    const data = {
        types: [],
        // Empty list opts out of the backend's default CPO-exclusion so admins can pick a
        // CPO mirror as the invite's payment option alongside regular plans.
        exclude_types: [],
        source: 'INSTITUTE',
        source_id: instituteId,
        require_approval: true,
        not_require_approval: true,
        // Both optional on the backend; omitting them is the old behaviour.
        search: search?.trim() || undefined,
        limit,
    };
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_PAYMENTS_URL,
        data,
    });
    return response?.data;
};

/**
 * @param search  Passed to the server. Part of the query key, so each term is
 *                cached separately and going back to a previous one is instant.
 * @param limit   Defaults to the whole list, which is what every caller had before
 *                this argument existed. A picker should pass
 *                {@link PAYMENT_OPTIONS_PAGE_SIZE}; a caller that resolves an
 *                already-selected option out of the result must not, or that
 *                option can fall outside the page and vanish.
 */
export const handleGetPaymentDetails = (
    search?: string,
    limit: number | null = null
) => {
    const trimmed = search?.trim() || '';
    return {
        queryKey: ['GET_PAYMENT_DETAILS', trimmed, limit],
        queryFn: () => getPaymentDetail(trimmed, limit ?? undefined),
        staleTime: 60 * 60 * 1000,
    };
};
