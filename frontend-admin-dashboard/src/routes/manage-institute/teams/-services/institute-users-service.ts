import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSTITUTE_USERS, GET_USER_ROLES_COUNT } from '@/constants/urls';

export interface InstituteUser {
    id: string;
    full_name: string;
    email: string | null;
    username?: string | null;
    mobile_number?: string | null;
    profile_pic_file_id?: string | null;
    roles?: string[];
}

interface RoleCount {
    role_name: string;
    user_count: number;
}

/**
 * Fetch every non-student member of the institute, including users assigned
 * to custom roles. Two-step because auth_service's users-of-status filter
 * is OR-additive on roles — passing a fixed allow-list misses custom roles
 * the admin may have created. We:
 *   1. Discover the institute's actual role list via /user-roles-count.
 *   2. Request users for every role except STUDENT in one call.
 *
 * If the institute has no roles registered yet (fresh institute) we fall
 * back to an empty result rather than fetching every student.
 */
export async function fetchEligibleOrgUsers(instituteId: string): Promise<InstituteUser[]> {
    const rolesResponse = await authenticatedAxiosInstance.get<RoleCount[]>(
        GET_USER_ROLES_COUNT,
        { params: { instituteId } }
    );
    const nonStudentRoles = (rolesResponse.data ?? [])
        .map((r) => r.role_name)
        .filter((name): name is string => !!name && name !== 'STUDENT');

    if (nonStudentRoles.length === 0) return [];

    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_INSTITUTE_USERS,
        params: { instituteId, pageNumber: 0, pageSize: 500 },
        data: {
            roles: nonStudentRoles,
            status: ['ACTIVE'],
        },
    });
    const raw = Array.isArray(response.data) ? response.data : response.data?.content ?? [];
    return raw.map((u: Record<string, unknown>) => ({
        id: u.id as string,
        full_name: (u.full_name as string) ?? '',
        email: (u.email as string) || null,
        username: (u.username as string) || null,
        mobile_number: (u.mobile_number as string) ?? null,
        profile_pic_file_id: (u.profile_pic_file_id as string) ?? null,
        roles: Array.isArray((u as { roles?: { role_name?: string }[] }).roles)
            ? ((u as { roles: { role_name?: string }[] }).roles)
                  .map((r) => r.role_name)
                  .filter((r): r is string => !!r)
            : [],
    }));
}
