import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    BASE_URL,
    GET_SUB_ORG_ADMINS,
    GET_SUB_ORG_MEMBERS,
    GET_SUB_ORG_SEAT_USAGE,
} from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export interface SubOrgAdmin {
    user_id: string;
    name: string;
    role: string;
}

export interface SubOrgAdminsResponse {
    user_id: string;
    package_session_id: string;
    sub_org_id: string;
    admins: SubOrgAdmin[];
    total_admins: number;
}

export interface SubOrgMember {
    id: string;
    user_id: string;
    package_session_id: string;
    sub_org_id: string;
    user: {
        id: string;
        username: string;
        email: string;
        full_name: string;
        mobile_number: string;
        roles: string[];
    };
    status: string;
}

export interface SubOrgMembersResponse {
    sub_org_details: {
        id: string;
        name: string;
        status: string;
        [key: string]: any;
    };
    student_mappings: SubOrgMember[];
}

export const fetchSubOrgAdmins = async (
    userId: string,
    packageSessionId: string,
    subOrgId: string
): Promise<SubOrgAdminsResponse> => {
    const response = await authenticatedAxiosInstance.get<SubOrgAdminsResponse>(
        `${GET_SUB_ORG_ADMINS}`,
        {
            params: {
                userId,
                packageSessionId,
                subOrgId,
            },
        }
    );
    return response.data;
};

export const fetchSubOrgMembers = async (
    packageSessionId: string,
    subOrgId: string
): Promise<SubOrgMembersResponse> => {
    const response = await authenticatedAxiosInstance.get<SubOrgMembersResponse>(
        `${GET_SUB_ORG_MEMBERS}`,
        {
            params: {
                package_session_id: packageSessionId,
                sub_org_id: subOrgId,
            },
        }
    );
    return response.data;
};

/** Seat usage of one batch of a sub-org. total_seats null = no limit configured. */
export interface SubOrgSeatUsage {
    package_session_id: string;
    package_name: string | null;
    used_seats: number;
    total_seats: number | null;
}

/** Same numbers add-member enforces, so the side view never disagrees with it. */
export const fetchSubOrgSeatUsage = async (
    subOrgId: string,
    packageSessionId: string
): Promise<SubOrgSeatUsage> => {
    const response = await authenticatedAxiosInstance.get<SubOrgSeatUsage>(
        GET_SUB_ORG_SEAT_USAGE,
        {
            params: {
                subOrgId,
                packageSessionId,
                parentInstituteId: getCurrentInstituteId(),
            },
        }
    );
    return response.data;
};

/** Sets the sub-org seat limit (MEMBER_COUNT). It applies to each batch of the sub-org. */
export const updateSubOrgSeatLimit = async (subOrgId: string, memberCount: number) => {
    const response = await authenticatedAxiosInstance.patch(
        `${BASE_URL}/admin-core-service/institute/v1/sub-org/${subOrgId}/configuration`,
        { member_count: memberCount },
        { params: { parentInstituteId: getCurrentInstituteId() } }
    );
    return response.data as { sub_org_id: string; applied: { member_count?: number } };
};
