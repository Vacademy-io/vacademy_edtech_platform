import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    INVITE_TEACHERS_URL,
    INVITE_USERS_URL,
    UPDATE_ADMIN_DETAILS_URL,
    UPDATE_USER_INVITATION_URL,
} from '@/constants/urls';
import { fetchInstituteDashboardUsers } from '@/routes/dashboard/-services/dashboard-services';
import type { PaginatedTeamResponse, TeamMember } from '../-utils/team-helpers';

export interface BatchSubjectMapping {
    batchId: string;
    subjectIds: string[];
}

export interface InviteTeamMemberInput {
    name: string;
    email: string;
    /** Digits including the dial code, as the phone widget produces them. */
    mobileNumber?: string;
    roles: string[];
    batchSubjectMappings?: BatchSubjectMapping[];
}

/** What the invite endpoint echoes back; the teacher path answers with a plain string. */
export interface InvitedUserResponse {
    username?: string;
    password?: string | null;
    /**
     * The email already had an account: the roles were added to it (active at once) and no
     * password was sent or returned — they sign in with their current login.
     */
    existing_account?: boolean;
    /** Existing account that already held every role here: nothing changed, no email sent. */
    already_member?: boolean;
}

/**
 * Adds one team member — active at once; a new account is emailed its login details. Both
 * endpoints take the same user payload with a roles
 * LIST, so any mix of built-in and custom roles works — Teacher only switches to the
 * faculty endpoint so the batch/subject assignment is written in the same call.
 */
export async function inviteTeamMember(
    instituteId: string,
    input: InviteTeamMemberInput
): Promise<InvitedUserResponse | null> {
    const user = {
        email: input.email,
        full_name: input.name,
        roles: input.roles,
        root_user: false,
        ...(input.mobileNumber ? { mobile_number: input.mobileNumber } : {}),
    };
    const mappings = input.batchSubjectMappings ?? [];
    if (input.roles.includes('TEACHER') && mappings.length > 0) {
        await authenticatedAxiosInstance.post(
            INVITE_TEACHERS_URL,
            {
                user,
                batch_subject_mappings: mappings.map((mapping) => ({
                    batch_id: mapping.batchId,
                    subject_ids: mapping.subjectIds,
                })),
                new_user: true,
            },
            { params: { instituteId } }
        );
        return null;
    }
    const response = await authenticatedAxiosInstance.post(INVITE_USERS_URL, user, {
        params: { instituteId },
    });
    return (response.data ?? null) as InvitedUserResponse | null;
}

/**
 * Updates an invite's name, email and roles. Roles are applied as a diff (kept roles keep
 * their status, new ones are active), and the auth service emails the login details again.
 */
export async function updateTeamInvite(
    instituteId: string,
    invite: TeamMember,
    input: { name: string; email: string; roles: string[] }
) {
    const response = await authenticatedAxiosInstance.put(
        UPDATE_USER_INVITATION_URL,
        {
            id: invite.id,
            username: invite.username,
            email: input.email,
            full_name: input.name,
            mobile_number: invite.mobile_number,
            profile_pic_file_id: invite.profile_pic_file_id,
            root_user: invite.root_user,
            roles: input.roles,
        },
        { params: { instituteId } }
    );
    return response.data;
}

export interface MemberDetailsUpdate {
    full_name?: string;
    email?: string;
    mobile_number?: string;
    /** Always sent: the endpoint overwrites the photo with whatever arrives, null included. */
    profile_pic_file_id: string | null;
    author_subtitle?: string;
    author_description?: string;
    /** user_role row ids (this institute's) to mark DELETED. */
    delete_user_role_request: string[];
    /** Role names to grant ACTIVE in this institute. */
    add_user_role_request: string[];
}

/** Profile + role changes for one member, in one call (auth-service user-details/update). */
export async function updateTeamMemberDetails(
    instituteId: string,
    userId: string,
    update: MemberDetailsUpdate
) {
    const response = await authenticatedAxiosInstance.post(
        `${UPDATE_ADMIN_DETAILS_URL}?userId=${encodeURIComponent(userId)}&instituteId=${encodeURIComponent(instituteId)}`,
        { id: userId, ...update }
    );
    return response.data;
}

export interface TeamListQuery {
    roles: string[];
    statuses: string[];
    name: string;
    /** Only when filtering by sub-org; the backend ANDs it with roles/status. */
    userIds?: string[];
}

export const fetchTeamPage = (
    instituteId: string | undefined,
    query: TeamListQuery,
    pageNumber: number,
    pageSize: number
): Promise<PaginatedTeamResponse> =>
    fetchInstituteDashboardUsers(
        instituteId,
        {
            roles: query.roles.map((name) => ({ id: name, name })),
            status: query.statuses.map((name) => ({ id: name, name })),
        },
        pageNumber,
        pageSize,
        query.name,
        query.userIds
    );

/**
 * Every row matching a list query, fetched in large pages — for export and for the bulk
 * import's "already on the team" check. Capped so a runaway institute can't hang the tab.
 */
export async function fetchAllTeamMembers(
    instituteId: string | undefined,
    query: TeamListQuery,
    { pageSize = 500, maxPages = 20 }: { pageSize?: number; maxPages?: number } = {}
): Promise<{ members: TeamMember[]; truncated: boolean }> {
    const members: TeamMember[] = [];
    for (let page = 0; page < maxPages; page += 1) {
        const result = await fetchTeamPage(instituteId, query, page, pageSize);
        members.push(...(result?.content ?? []));
        if (!result || result.last || (result.content ?? []).length < pageSize) {
            return { members, truncated: false };
        }
    }
    return { members, truncated: true };
}

export interface TeamCounts {
    active: number;
    disabled: number;
    invited: number;
}

/** Totals for the summary cards and tab badges — one size-1 page per status. */
export async function fetchTeamCounts(
    instituteId: string | undefined,
    roles: string[]
): Promise<TeamCounts> {
    const total = async (status: string) =>
        (await fetchTeamPage(instituteId, { roles, statuses: [status], name: '' }, 0, 1))
            ?.total_elements ?? 0;
    const [active, disabled, invited] = await Promise.all([
        total('ACTIVE'),
        total('DISABLED'),
        total('INVITED'),
    ]);
    return { active, disabled, invited };
}
