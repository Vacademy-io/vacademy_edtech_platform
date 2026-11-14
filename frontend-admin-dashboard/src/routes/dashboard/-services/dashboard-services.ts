import {
    ADD_USER_ROLES_URL,
    DELETE_DISABLE_USER_URL,
    GET_DASHBOARD_ASSESSMENT_COUNT_URL,
    GET_DASHBOARD_URL,
    GET_INSTITUTE_USERS,
    INVITE_TEACHERS_URL,
    INVITE_USERS_URL,
    RESEND_INVITATION_URL,
    UPDATE_ADMIN_DETAILS_URL,
    UPDATE_DASHBOARD_URL,
    UPDATE_USER_INVITATION_URL,
    // GET_ALL_FACULTY,
    GET_FACULTY_BY_INSTITUTE_CREATORS_ONLY,
    GET_ALL_FACULTY_V2,
    GET_DOUBTS,
    ANALYTICS_USER_ACTIVITY,
    ANALYTICS_ACTIVE_USERS_REALTIME,
    ANALYTICS_ACTIVE_USERS,
    ANALYTICS_ACTIVITY_TODAY,
    ANALYTICS_SERVICE_USAGE,
    ANALYTICS_ENGAGEMENT_TRENDS,
    ANALYTICS_MOST_ACTIVE_USERS,
    ANALYTICS_CURRENTLY_ACTIVE_USERS,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { RoleTypeSelectedFilter } from '../-components/RoleTypeComponent';
import { z } from 'zod';
import { inviteUsersSchema } from '../-components/InviteUsersComponent';
import { UserRolesDataEntry } from '@/types/dashboard/user-roles';
import type { EditDashboardProfileFormValues } from '../-utils/edit-dashboard-profile-schema';
import type { AdminProfileFormValues } from '../-utils/admin-profile-schema';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getInstituteId } from '@/constants/helper';
import { getModifiedAdminRoles } from '../-utils/helper';
import { UserRole } from '@/services/student-list-section/getAdminDetails';
import { inviteTeacherSchema } from '../-components/AddTeachers';
import { queryOptions } from '@tanstack/react-query';
import {
    DoubtFilter,
    PaginatedDoubtResponse,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';

export interface FacultyFilterParams {
    name?: string;
    batches?: string[];
    subjects?: string[];
    status?: string[];
    sort_columns?: Record<string, 'ASC' | 'DESC'>;
}

export const fetchFacultyList = async (
    instituteId: string,
    pageNo: number = 0,
    pageSize: number = 10,
    filters: FacultyFilterParams = {}
) => {
    try {
        const response = await authenticatedAxiosInstance({
            method: 'POST',
            url: GET_ALL_FACULTY_V2,
            params: {
                instituteId,
                pageNo,
                pageSize,
            },
            data: {
                name: filters.name,
                subjects: filters.subjects,
                batches: filters.batches,
                status: filters.status,
                sortColumns: filters.sort_columns,
            },
        });
        const data = response.data as Record<string, unknown>;
        if (data && typeof data === 'object') {
            return {
                content: data.content ?? [],
                page_no: data.page_no ?? data.pageNo ?? pageNo,
                page_size: data.page_size ?? data.pageSize ?? pageSize,
                total_elements: data.total_elements ?? data.totalElements ?? 0,
                total_pages: data.total_pages ?? data.totalPages ?? 0,
                last: data.last ?? true,
            };
        }
        return response.data;
    } catch (error: unknown) {
        console.error('Error fetching faculty list:', error);
        throw error;
    }
};

// Add the specific function for faculty creators that matches the hook usage
export const fetchFacultyCreatorsByInstitute = async (instituteId: string) => {
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: `${GET_FACULTY_BY_INSTITUTE_CREATORS_ONLY}/${instituteId}`,
        });
        console.log('Faculty Creators API Response:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error fetching faculty creators list:', error);
        throw error;
    }
};

export const fetchInstituteDashboardDetails = async (instituteId: string | undefined) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_DASHBOARD_URL,
        params: {
            instituteId,
        },
    });
    return response.data;
};

export const fetchAssessmentsCountDetailsForInstitute = async (instituteId: string | undefined) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_DASHBOARD_ASSESSMENT_COUNT_URL,
        params: {
            instituteId,
        },
    });
    return response.data;
};

export const getInstituteDashboardData = (instituteId: string | undefined) => {
    return {
        queryKey: ['GET_INSTITUTE_DASHBOARD_DATA', instituteId],
        queryFn: async () => {
            const data = await fetchInstituteDashboardDetails(instituteId);
            return data;
        },
        staleTime: 3600000,
    };
};

export const getAssessmentsCountsData = (instituteId: string | undefined) => {
    return {
        queryKey: ['GET_ASSESSMENT_COUNT_DATA', instituteId],
        queryFn: async () => {
            const data = await fetchAssessmentsCountDetailsForInstitute(instituteId);
            return data;
        },
        staleTime: 3600000,
    };
};

export const fetchInstituteDashboardUsers = async (
    instituteId: string | undefined,
    selectedFilter: RoleTypeSelectedFilter,
    pageNumber: number = 0,
    pageSize: number = 10,
    name: string = '',
    userIds?: string[]
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_INSTITUTE_USERS,
        params: {
            instituteId,
            pageNumber,
            pageSize,
        },
        data: {
            roles: selectedFilter.roles.map((role) => role.name),
            status: selectedFilter.status.map((status) => status.name),
            name,
            // Only sent when filtering by sub-org; auth-service ANDs it with roles/status.
            ...(userIds !== undefined ? { user_ids: userIds } : {}),
        },
    });
    return response.data;
};

export const handleGetInstituteUsersForAccessControl = (
    instituteId: string | undefined,
    selectedFilter: RoleTypeSelectedFilter
) => {
    return {
        queryKey: ['GET_INSTITUTE_USERS_FOR_ACCESS_CONTROL', instituteId, selectedFilter],
        queryFn: async () => {
            const data = await fetchInstituteDashboardUsers(instituteId, selectedFilter);
            return data;
        },
        staleTime: 3600000,
    };
};

export const handleInviteUsers = async (
    instituteId: string | undefined,
    data: z.infer<typeof inviteUsersSchema>
) => {
    let url = INVITE_USERS_URL;
    const userData = {
        email: data.email,
        full_name: data.name,
        roles: data.roleType,
        root_user: false,
    };
    type UserPayload =
        | typeof userData
        | {
              user: typeof userData;
              batch_subject_mappings: typeof data.batch_subject_mappings;
              new_user: boolean;
          };
    let payload: UserPayload = userData;
    if (data.roleType.includes('TEACHER') && data.batch_subject_mappings) {
        url = INVITE_TEACHERS_URL;
        payload = {
            user: userData,
            // @ts-expect-error : batch_subject_mappings is not defined in the type
            batch_subject_mappings: data.batch_subject_mappings.map((batch) => ({
                batch_id: batch.batchId,
                subject_ids: batch.subjectIds,
            })),
            new_user: true,
        };
    }
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url,
        params: {
            instituteId,
        },
        data: payload,
    });
    return response.data;
};

export const handleInviteTeachers = async (
    instituteId: string | undefined,
    data: z.infer<typeof inviteTeacherSchema>,
    isNewUser: boolean = true
) => {
    const userData = {
        email: data.email,
        full_name: data.name,
        roles: ['TEACHER'],
        root_user: false,
    };
    const payload = {
        user: userData,
        batch_subject_mappings: (data.batch_subject_mappings || []).map((batch) => ({
            batch_id: batch.batchId,
            subject_ids: batch.subjectIds,
        })),
        new_user: isNewUser,
    };
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: INVITE_TEACHERS_URL,
        params: {
            instituteId,
        },
        data: payload,
    });
    return response.data;
};
export const handleDeleteDisableDashboardUsers = async (
    instituteId: string | undefined,
    status: string,
    userId: string
) => {
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: DELETE_DISABLE_USER_URL,
        params: {
            instituteId,
            status,
        },
        data: [userId],
    });
    return response.data;
};

export const handleAddUserDashboardRoles = async (
    roles: string[],
    userId: string,
    instituteId: string | undefined
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: ADD_USER_ROLES_URL,
        data: {
            roles: roles,
            user_id: userId,
            institute_id: instituteId,
        },
    });
    return response.data;
};

export const handleUpdateUserInvitation = async (
    instituteId: string | undefined,
    data: z.infer<typeof inviteUsersSchema>,
    student: UserRolesDataEntry
) => {
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: UPDATE_USER_INVITATION_URL,
        params: {
            instituteId,
        },
        data: {
            ...student,
            full_name: data.name,
            email: data.email,
            roles: data.roleType,
        },
    });
    return response.data;
};

/**
 * Emails a member their login details again, branded as and listing the roles of
 * `instituteId` (the institute the caller must be staff of).
 */
export const handleResendUserInvitation = async (
    userId: string,
    instituteId: string | undefined = getInstituteId()
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: RESEND_INVITATION_URL,
        params: {
            userId,
            instituteId,
        },
    });
    return response.data;
};

export const handleUpdateInstituteDashboard = async (
    data: EditDashboardProfileFormValues,
    instituteId: string | undefined
) => {
    const convertedData = {
        institute_name: data.instituteName,
        id: instituteId,
        country: data.instituteCountry,
        state: data.instituteState,
        city: data.instituteCity,
        address: data.instituteAddress,
        pin_code: data.institutePinCode,
        phone: data.institutePhoneNumber,
        email: data.instituteEmail,
        website_url: data.instituteWebsite,
        institute_logo_file_id: data.instituteProfilePictureId,
        institute_theme_code: data.instituteThemeCode,
        language: '',
        description: '',
        type: data.instituteType,
        held_by: '',
        founded_date: '',
        module_request_ids: [],
        sub_modules: [],
        sessions: [],
        batches_for_sessions: [],
        levels: [],
        genders: [],
        student_statuses: [],
        subjects: [],
        session_expiry_days: [],
        letter_head_file_id: '',
    };
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: UPDATE_DASHBOARD_URL,
        data: convertedData,
        params: {
            instituteId,
        },
    });
    return response?.data;
};

export const handleUpdateAdminDetails = async (
    adminDetailsData: AdminProfileFormValues,
    roles: UserRole[],
    oldRoles: string[],
    newRoles: string[]
) => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const instituteId = getInstituteId();

    const convertedData = {
        id: tokenData?.user,
        email: adminDetailsData.email,
        full_name: adminDetailsData.name,
        address_line: '',
        city: '',
        region: '',
        pin_code: '',
        mobile_number: adminDetailsData.phone,
        date_of_birth: '',
        gender: '',
        profile_pic_file_id: adminDetailsData.profilePictureId,
        roles: [],
        delete_user_role_request: getModifiedAdminRoles(roles, oldRoles, newRoles)
            .delete_user_role_request,
        add_user_role_request: getModifiedAdminRoles(roles, oldRoles, newRoles)
            .add_user_role_request,
    };

    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: UPDATE_ADMIN_DETAILS_URL,
        data: convertedData,
        params: {
            instituteId,
            userId: tokenData?.user,
        },
    });
    return response?.data;
};

export const getUnresolvedDoubtsCount = (instituteId: string, batchIds: string[] = []) => {
    return queryOptions({
        queryKey: ['GET_UNRESOLVED_DOUBTS_COUNT', instituteId, batchIds],
        queryFn: async () => {
            // Calculate date range for last 7 days
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 1); // Set to tomorrow to include today's doubts
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);

            const filter: DoubtFilter = {
                name: '',
                start_date: startDate.toISOString(),
                end_date: endDate.toISOString(),
                user_ids: [],
                content_positions: [],
                content_types: [],
                sources: [],
                source_ids: [],
                status: ['ACTIVE'], // Only unresolved doubts
                sort_columns: {},
                batch_ids: batchIds, // Use provided batch IDs
            };

            const response = await authenticatedAxiosInstance.post<PaginatedDoubtResponse>(
                `${GET_DOUBTS}?pageNo=0&pageSize=1`,
                filter
            );

            return {
                count: response.data.total_elements,
                hasUnresolvedDoubts: response.data.total_elements > 0,
            };
        },
        enabled: !!instituteId && batchIds.length > 0,
    });
};

export const fetchAnalyticsUserActivity = async (instituteId: string, token?: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ANALYTICS_USER_ACTIVITY,
        params: { instituteId },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.data;
};

export const fetchAnalyticsActiveUsersRealtime = async (instituteId: string, token?: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ANALYTICS_ACTIVE_USERS_REALTIME,
        params: { instituteId },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.data;
};

export const fetchAnalyticsActiveUsers = async (instituteId: string, token?: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ANALYTICS_ACTIVE_USERS,
        params: { instituteId },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.data;
};

export const fetchAnalyticsActivityToday = async (instituteId: string, token?: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ANALYTICS_ACTIVITY_TODAY,
        params: { instituteId },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.data;
};

export const fetchAnalyticsServiceUsage = async (instituteId: string, token?: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ANALYTICS_SERVICE_USAGE,
        params: { instituteId },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.data;
};

export const fetchAnalyticsEngagementTrends = async (
    instituteId: string,
    token?: string,
    startDate?: string,
    endDate?: string
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ANALYTICS_ENGAGEMENT_TRENDS,
        params: { instituteId, startDate, endDate },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.data;
};

export const fetchAnalyticsMostActiveUsers = async (
    instituteId: string,
    token?: string,
    limit = 10,
    offset = 0
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ANALYTICS_MOST_ACTIVE_USERS,
        params: { instituteId, limit, offset },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.data;
};

export const fetchAnalyticsCurrentlyActiveUsers = async (instituteId: string, token?: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ANALYTICS_CURRENTLY_ACTIVE_USERS,
        params: { instituteId },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.data;
};
