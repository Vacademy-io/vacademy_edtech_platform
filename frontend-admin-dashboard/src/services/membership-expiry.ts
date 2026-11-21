import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import type { MembershipDetailsResponse, MembershipFilterDTO } from '@/types/membership-expiry';

export const MEMBERSHIP_EXPIRY_URL = `${BASE_URL}/admin-core-service/v1/user-plan/membership-details`;

/**
 * Fetch membership expiry details
 */
export const fetchMembershipExpiry = async (
    pageNo: number = 0,
    pageSize: number = 20,
    requestBody: Omit<MembershipFilterDTO, 'institute_id'>
): Promise<MembershipDetailsResponse> => {
    const instituteId = getCurrentInstituteId();

    if (!instituteId) {
        throw new Error('Institute ID not found');
    }

    const finalRequestBody: MembershipFilterDTO = {
        ...requestBody,
        institute_id: instituteId,
    };

    const response = await authenticatedAxiosInstance.post<MembershipDetailsResponse>(
        MEMBERSHIP_EXPIRY_URL,
        finalRequestBody,
        {
            params: {
                pageNo,
                pageSize,
            },
        }
    );

    return response.data;
};

/**
 * Fetch every membership row matching the filters (used by CSV export).
 * Walks the paginated endpoint so the export isn't limited to the visible page.
 */
export const fetchAllMembershipExpiry = async (
    requestBody: Omit<MembershipFilterDTO, 'institute_id'>,
    pageSize: number = 200
): Promise<MembershipDetailsResponse['content']> => {
    const rows: MembershipDetailsResponse['content'] = [];
    let pageNo = 0;
    let totalPages = 1;

    while (pageNo < totalPages) {
        const page = await fetchMembershipExpiry(pageNo, pageSize, requestBody);
        rows.push(...page.content);
        totalPages = page.totalPages;
        if (page.last || page.content.length === 0) break;
        pageNo += 1;
    }

    return rows;
};

/**
 * Query Key for React Query
 */
export const getMembershipExpiryQueryKey = (
    pageNo: number,
    pageSize: number,
    filters: Omit<MembershipFilterDTO, 'institute_id'>
) => ['membership-expiry', pageNo, pageSize, filters];
