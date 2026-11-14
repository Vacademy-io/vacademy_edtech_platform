import { getInstituteId } from '@/constants/helper';
import { GET_INVITE_LINKS, MAKE_INVITE_LINK_DEFAULT } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

/**
 * Newest first. The backend query has no ORDER BY of its own, so an empty
 * sort_columns handed Postgres free rein over the order and the list
 * reshuffled between fetches. The service now defaults to this too; sending it
 * keeps the FE explicit about what it expects.
 */
const NEWEST_FIRST = { created_at: 'DESC' } as const;

const fetchInviteLinks = async (
    packageSessionIds: string[],
    pageNo: number,
    pageSize: number,
    searchName = ''
) => {
    const instituteId = getInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_INVITE_LINKS,
        params: { instituteId, pageNo, pageSize },
        data: {
            search_name: searchName.trim(),
            package_session_ids: packageSessionIds,
            payment_option_ids: [],
            sort_columns: NEWEST_FIRST,
            tags: [],
        },
    });
    return response?.data;
};
export const handleFetchInviteLinks = (
    packageSessionIds: string[],
    pageNo: number,
    pageSize: number,
    searchName = ''
) => {
    return {
        queryKey: ['GET_INVITE_LINKS', packageSessionIds, pageNo, pageSize, searchName],
        queryFn: async () => {
            const data = await fetchInviteLinks(packageSessionIds, pageNo, pageSize, searchName);
            return data;
        },
        staleTime: 60 * 60 * 1000,
    };
};

export const handleMakeInviteLinkDefault = async (
    packageSessionId: string,
    inviteLinkId: string
) => {
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: MAKE_INVITE_LINK_DEFAULT,
        params: { enrollInviteId: inviteLinkId, packageSessionId },
    });
    return response?.data;
};
