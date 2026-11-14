import type { OfflinePaymentDetails } from '@/services/offline-payment-modes';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GRANT_USER_ACCESS,
    GET_ALL_FACULTY_V2,
    CREATE_SUB_ORG,
    GET_ALL_SETTINGS,
    SAVE_GENERIC_SETTING,
    ROLES_BASE,
    INVITE_USERS_URL,
    GET_SUB_ORGS,
    GET_SUB_ORGS_WITH_DETAILS,
    CREATE_SUB_ORG_WITH_SUBSCRIPTION,
    GET_SUB_ORG_SCOPED_INVITES,
    GET_SUB_ORG_SEAT_USAGE,
    GET_SUB_ORG_SUBSCRIPTION_STATUS,
    ADD_SUB_ORG_MEMBER,
    SUB_ORG_TEAM_LIST,
    SUB_ORG_TEAM_ADD,
    SUB_ORG_TEAM_REMOVE,
    SUB_ORG_TEAM_ACCESSIBLE,
    SUB_ORG_TEAM_USER_LINKS,
    SUB_ORG_TEAM_ACCESSIBLE_GRANTS,
    SUB_ORG_TEAM_PENDING_INSTALLMENTS,
    GET_SUB_ORG_FINANCE_DETAIL,
    GET_INVOICES_BY_USER,
    BASE_URL,
} from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export interface GrantUserAccessRequest {
    user_id: string;
    package_session_id?: string;
    subject_id?: string;
    status: 'ACTIVE' | 'INACTIVE';
    name: string;
    user_type: string;
    type_id: string;
    access_type: string;
    access_id: string;
    access_permission: string;
    linkage_type: 'DIRECT' | 'INHERITED' | 'PARTNERSHIP';
    suborg_id?: string;
}

export interface FacultyFilterRequest {
    name?: string;
    subjects?: string[];
    batches?: string[];
    status?: string[];
    sortColumns?: Record<string, 'ASC' | 'DESC'>;
    pageNo?: number;
    pageSize?: number;
}

export interface CreateSubOrgRequest {
    institute_name: string;
    email?: string;
    phone?: string;
    description?: string;
    institute_logo_file_id?: string;
}

export interface CustomRole {
    id: string;
    name: string;
    permissions: string[]; // IDs of permissions
    /**
     * Owning institute: null for platform roles, this institute's id for roles it
     * created. CustomRoleDTO has no naming strategy, so the wire name is camelCase;
     * the snake_case spelling is accepted too in case that ever changes.
     */
    instituteId?: string | null;
    institute_id?: string | null;
}

/** Request body for POST /institute/{instituteId}/roles (Create) and PUT .../roles/{roleId} (Update) */
export interface CreateRoleDTO {
    name: string;
    permissionIds: string[];
}

export interface AssignFacultyRequest {
    user: {
        fullName: string;
        email: string;
        mobileNumber: string;
        countryCode?: string;
    };
    isNewUser: boolean;
    batchSubjectMappings?: Array<{
        batchId: string;
        subjectIds: string[];
    }>;
}

export interface InviteUserRequest {
    email: string;
    full_name: string;
    roles: string[];
    root_user: boolean;
}

export const inviteUser = async (data: InviteUserRequest) => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: INVITE_USERS_URL,
        params: { instituteId },
        data,
    });
    return response.data;
};

export const assignFacultyToSubjectsAndBatches = async (data: AssignFacultyRequest) => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: INVITE_USERS_URL,
        params: { instituteId },
        data,
    });
    return response.data;
};

export const grantUserAccess = async (data: GrantUserAccessRequest) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GRANT_USER_ACCESS,
        data,
    });
    return response.data;
};

export const getAllFacultyV2 = async (filters: FacultyFilterRequest) => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_ALL_FACULTY_V2,
        params: {
            instituteId,
            pageNo: filters.pageNo || 0,
            pageSize: filters.pageSize || 10,
        },
        data: {
            name: filters.name,
            subjects: filters.subjects,
            batches: filters.batches,
            status: filters.status,
            sortColumns: filters.sortColumns,
        },
    });
    return response.data;
};

export const createSubOrg = async (data: CreateSubOrgRequest) => {
    const parentInstituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: CREATE_SUB_ORG,
        params: { parentInstituteId },
        data,
    });
    return response.data;
};

export const getSubOrgs = async (parentInstituteId?: string) => {
    const id = parentInstituteId || getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_SUB_ORGS,
        params: { parentInstituteId: id },
    });
    return response.data;
};

/** Enriched VLE/sub-org list row: record + admin contact + plan status + seats + invite. */
export interface SubOrgListItem {
    suborg_id?: string | null;
    name?: string | null;
    status?: string | null;
    /** auth user id of the root admin — the recipient of the row's "Share credentials" action. */
    admin_user_id?: string | null;
    admin_name?: string | null;
    admin_email?: string | null;
    admin_phone?: string | null;
    /** Address stamped on the spawned institute at registration; null when never collected.
     *  `address_line` is the street line as typed (registration line 1 + line 2 joined) —
     *  free text that often repeats the city/state, so it is shown as its own column rather
     *  than composed together with the fields below. */
    address_line?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    /** Admin's UserPlan status (ACTIVE, PENDING_FOR_PAYMENT, …); null when no plan. */
    plan_status?: string | null;
    used_seats?: number | null;
    total_seats?: number | null;
    /** Distinct ACTIVE learners enrolled under this sub-org (admins excluded). Same
     *  population as used_seats, but always present — used_seats reads as blank when
     *  the sub-org has no seat cap configured. */
    learner_count?: number | null;
    invite_code?: string | null;
    short_url?: string | null;
    created_at?: string | number | null;
}

/** Paginated Manage VLEs list (snake_case rows in a camelCase Spring Page wrapper). */
export interface SubOrgListPage {
    content: SubOrgListItem[];
    total_pages: number;
    total_elements: number;
    /** 0-based current page. */
    page_no: number;
    page_size: number;
    last: boolean;
}

/**
 * Manage VLEs list — one call returns admin email/phone, plan status, seats, learner count
 * and invite per sub-org (newest first). Omit page/size to fetch EVERYTHING (the backend's
 * legacy bare-array shape) — used by the list screen so search/status filters can match
 * across the whole dataset (admin email/phone/plan status come from cross-service
 * enrichment, so they can't be filtered in the DB query). Pass page+size for the paginated
 * Spring Page shape.
 *
 * "EVERYTHING" is always relative to the caller: the backend scopes the response to the
 * sub-orgs assigned to them unless they're a root user or a true institute admin. So the
 * client-side search/filter/pagination below inherently operates on the assigned set only.
 */
export const getSubOrgsWithDetails = async (
    parentInstituteId?: string,
    page?: number,
    size?: number
): Promise<SubOrgListPage> => {
    const id = parentInstituteId || getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_SUB_ORGS_WITH_DETAILS,
        // axios drops undefined params — no page/size sent → backend returns the full bare array.
        params: { parentInstituteId: id, page, size },
    });
    const data = response.data;
    if (Array.isArray(data)) {
        return {
            content: data,
            total_pages: 1,
            total_elements: data.length,
            page_no: 0,
            page_size: data.length,
            last: true,
        };
    }
    return {
        content: Array.isArray(data?.content) ? data.content : [],
        total_pages: data?.totalPages ?? 1,
        total_elements: data?.totalElements ?? 0,
        page_no: data?.number ?? 0,
        page_size: data?.size ?? size ?? 10,
        last: data?.last ?? true,
    };
};

// Global role rows seeded in 2024 that nothing uses any more. "Admin" (id 1) is a
// near-duplicate of the real "ADMIN" (id 5): both render as "Admin" in pickers, and
// anyone given id 1 lands on a stripped admin dashboard because the FE gates on
// 'ADMIN' case-sensitively. Matched by exact name — role_name is unique, so these
// strings can never collide with ADMIN or a custom role. The auth service filters
// the same list; this keeps them hidden regardless of deploy order.
export const LEGACY_ROLE_NAMES = ['Admin', 'User', 'Moderator', 'Guest'];

export const getAllRoles = async () => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${ROLES_BASE}/${instituteId}/roles`,
    });
    return Array.isArray(response.data)
        ? response.data.filter(
              (role: { name?: string }) => !LEGACY_ROLE_NAMES.includes(role?.name ?? '')
          )
        : response.data;
};

export const createCustomRole = async (payload: CreateRoleDTO) => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${ROLES_BASE}/${instituteId}/roles`,
        data: payload,
    });
    return response.data;
};

export const updateCustomRole = async (roleId: string, payload: CreateRoleDTO) => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: `${ROLES_BASE}/${instituteId}/roles/${roleId}`,
        data: payload,
    });
    return response.data;
};

export const deleteCustomRole = async (roleId: string) => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'DELETE',
        url: `${ROLES_BASE}/${instituteId}/roles/${roleId}`,
    });
    return response.data;
};

// --- Sub-Org Subscription APIs ---

export interface CreateSubOrgSubscriptionRequest {
    sub_org_details: {
        institute_name: string;
        email?: string;
        phone?: string;
        institute_logo_file_id?: string;
    };
    package_session_ids: string[];
    payment_type: 'SUBSCRIPTION' | 'ONE_TIME' | 'FREE' | 'CPO';
    actual_price?: number;
    elevated_price?: number;
    currency?: string;
    member_count: number;
    validity_in_days: number;
    vendor?: string;
    vendor_id?: string;
    auth_roles?: string[];
    /** Custom roles the sub-org admin can later assign on /manage-suborg-teams.
     *  Empty / undefined = no restriction. */
    allowed_team_roles?: string[];
    /** Required when payment_type === 'CPO'. */
    complex_payment_option_id?: string;
    /** Existing institute-level PaymentOption the sub-org admin pays via. Required for the
     *  non-CPO gateway/free types (ONE_TIME, SUBSCRIPTION, FREE) — the backend reuses this
     *  option + its plan instead of minting a fresh one from manually-typed prices. */
    payment_option_id?: string;
    /** Permissions stamped on the sub-org admin's FSPSSM rows when they're enrolled
     *  (e.g. ["FULL"], ["CREATE_COURSE"]). Persisted on settingJson.ADMIN_PERMISSIONS.
     *  Empty / undefined → defaults to "FULL" (legacy behaviour). */
    admin_permissions?: string[];
}

export interface CreateSubOrgSubscriptionResponse {
    sub_org_id: string;
    enroll_invite_id: string;
    invite_code: string;
    short_url: string;
}

export interface SeatUsage {
    package_session_id: string;
    package_name: string;
    used_seats: number;
    total_seats: number;
}

export interface SubOrgSubscriptionStatus {
    sub_org_id: string;
    org_user_plan_status: string;
    seat_usages: SeatUsage[];
    invite_code: string;
    short_url: string;
}

export const createSubOrgWithSubscription = async (
    data: CreateSubOrgSubscriptionRequest
): Promise<CreateSubOrgSubscriptionResponse> => {
    const parentInstituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: CREATE_SUB_ORG_WITH_SUBSCRIPTION,
        params: { parentInstituteId },
        data,
    });
    return response.data;
};

/**
 * Replace the ALLOWED_TEAM_ROLES list for a sub-org. Pass an empty list to clear
 * (no restriction). Editable by the parent institute admin only.
 */
export const updateSubOrgTeamRoles = async (
    subOrgId: string,
    allowedTeamRoles: string[]
): Promise<{ sub_org_id: string; allowed_team_roles: string[] }> => {
    const parentInstituteId = getCurrentInstituteId();
    const url = `${BASE_URL}/admin-core-service/institute/v1/sub-org/${subOrgId}/team-roles`;
    const response = await authenticatedAxiosInstance({
        method: 'PATCH',
        url,
        params: { parentInstituteId },
        data: { allowed_team_roles: allowedTeamRoles },
    });
    return response.data;
};

export interface SubOrgConfigurationUpdate {
    auth_roles?: string[];
    allowed_team_roles?: string[];
    admin_permissions?: string[];
    member_count?: number;
    validity_in_days?: number;
    /**
     * Add-only list of new PS ids to link to this sub-org. Existing PSes can't be
     * removed via this surface — removing would orphan already-enrolled learners.
     * The backend returns the actual subset added under `applied.added_package_session_ids`
     * so duplicates are surfaced as such in the FE toast.
     */
    add_package_session_ids?: string[];
    /**
     * Swap the institute-level PaymentOption that backs the sub-org admin's payment
     * collection. Rewrites the org-level invite's PSLIPO rows. Affects FUTURE admin
     * enrollments only — an admin who already accepted the invite keeps their plan.
     */
    payment_option_id?: string;
}

/**
 * Consolidated sub-org config edit. Each field is optional — only present fields are
 * applied. Used by the "Edit Sub-Org" modal on the institute-admin deep page. Returns
 * the subset the backend actually applied so the FE can show precise feedback.
 */
export const updateSubOrgConfiguration = async (
    subOrgId: string,
    update: SubOrgConfigurationUpdate
): Promise<{ sub_org_id: string; applied: SubOrgConfigurationUpdate }> => {
    const parentInstituteId = getCurrentInstituteId();
    const url = `${BASE_URL}/admin-core-service/institute/v1/sub-org/${subOrgId}/configuration`;
    const response = await authenticatedAxiosInstance({
        method: 'PATCH',
        url,
        params: { parentInstituteId },
        data: update,
    });
    return response.data;
};

/**
 * Re-run the SUBORG_LEARNER mirror logic for every PS already linked to this sub-org's
 * org-level invite. Idempotent — only creates invites for institute-wide PaymentOptions
 * that aren't already mirrored. Used by the "Re-sync invites" button on the deep page.
 *
 * Also re-applies the institute's current Naming Settings terminology to existing
 * sub-org invite names (`renamed_count`) — invite names are written once at creation,
 * so this is how a term rename reaches invites that already exist.
 */
export const resyncSubOrgInvites = async (
    subOrgId: string
): Promise<{
    sub_org_id: string;
    created_count: number;
    renamed_count: number;
    package_session_count: number;
}> => {
    const parentInstituteId = getCurrentInstituteId();
    const url = `${BASE_URL}/admin-core-service/institute/v1/sub-org/${subOrgId}/resync-invites`;
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url,
        params: { parentInstituteId },
    });
    return response.data;
};

/** What the backend reports after re-sending a sub-org admin's login details. */
export interface ResendSubOrgAdminCredentialsResult {
    sub_org_id: string;
    user_id: string;
    /** 1 when the notification service accepted the email, else 0. */
    sent: number;
    failed: number;
    /** Backend's own explanation — surfaced verbatim when nothing was sent. */
    message?: string | null;
}

/**
 * Re-send the sub-org admin's current login details by email (Manage VLEs → row menu →
 * "Share credentials"). The mail is branded for the parent institute and links to its admin
 * portal. Read-only on the admin's account: nothing is rotated or re-enrolled.
 */
export const resendSubOrgAdminCredentials = async (
    subOrgId: string
): Promise<ResendSubOrgAdminCredentialsResult> => {
    const parentInstituteId = getCurrentInstituteId();
    const url = `${BASE_URL}/admin-core-service/institute/v1/sub-org/${subOrgId}/resend-admin-credentials`;
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url,
        params: { parentInstituteId },
    });
    return response.data;
};

/**
 * Replace the ADMIN_PERMISSIONS list for a sub-org (FSPSSM access_permission CSV).
 * Pass an empty list to clear and fall back to the legacy "FULL" default. Existing
 * FSPSSM rows are not back-filled; only admin users enrolled after this call pick
 * up the new value. Parent institute admin only.
 */
export const updateSubOrgAdminPermissions = async (
    subOrgId: string,
    adminPermissions: string[]
): Promise<{ sub_org_id: string; admin_permissions: string[] }> => {
    const parentInstituteId = getCurrentInstituteId();
    const url = `${BASE_URL}/admin-core-service/institute/v1/sub-org/${subOrgId}/admin-permissions`;
    const response = await authenticatedAxiosInstance({
        method: 'PATCH',
        url,
        params: { parentInstituteId },
        data: { admin_permissions: adminPermissions },
    });
    return response.data;
};

export const getScopedInvites = async (subOrgId: string) => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_SUB_ORG_SCOPED_INVITES,
        params: { subOrgId, instituteId },
    });
    return response.data;
};

export const getSeatUsage = async (
    subOrgId: string,
    packageSessionId: string
): Promise<SeatUsage> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_SUB_ORG_SEAT_USAGE,
        params: { subOrgId, packageSessionId },
    });
    return response.data;
};

export const getSubscriptionStatus = async (
    subOrgId: string
): Promise<SubOrgSubscriptionStatus> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_SUB_ORG_SUBSCRIPTION_STATUS,
        params: { subOrgId, instituteId },
    });
    return response.data;
};

// --- Add User to Sub-Org ---

export interface AddSubOrgMemberInstallmentOverride {
    aft_installment_id: string;
    start_date?: string;
    due_date?: string;
    amount?: number;
    discount?: {
        type: 'PERCENTAGE' | 'FLAT';
        value: number;
        reason?: string;
    };
}

export interface AddSubOrgMemberCpoConfig {
    installment_overrides?: AddSubOrgMemberInstallmentOverride[];
    cpo_discount?: {
        type: 'PERCENTAGE' | 'FLAT';
        value: number;
        reason?: string;
    };
}

export interface AddSubOrgMemberRequest {
    user: {
        email: string;
        full_name: string;
        mobile_number?: string;
        roles: string[];
    };
    package_session_id?: string;
    /** Multi-PS variant — admin gets access to every PS in the list in one round-trip. */
    package_session_ids?: string[];
    sub_org_id: string;
    institute_id: string;
    comma_separated_org_roles: string;
    status?: string;

    // Optional manual offline-payment recording. Mirrors bulk/v3/assign non-CPO path.
    payment_mode?: 'SKIP' | 'OFFLINE';
    offline_payment_amount?: number;
    offline_payment_currency?: string;
    offline_payment_date?: string; // ISO
    offline_payment_reference?: string;
    /** How the offline payment was made (mode, option, reference, proof). */
    offline_payment_details?: OfflinePaymentDetails | null;
    generate_invoice?: boolean;

    // Per-learner payment-option override. When set to a CPO mirror id, the backend
    // generates SFPs + applies cpo_config + FIFO-allocates offline payment.
    payment_option_id?: string;
    cpo_config?: AddSubOrgMemberCpoConfig;
}

export interface AddSubOrgMemberResponse {
    user: {
        id: string;
        email: string;
        full_name: string;
    };
    mapping_id: string;
    message: string;
    payment_log_id?: string | null;
    invoice_id?: string | null;
}

export const addSubOrgMember = async (
    data: AddSubOrgMemberRequest
): Promise<AddSubOrgMemberResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: ADD_SUB_ORG_MEMBER,
        data,
    });
    return response.data;
};

// --- Sub-Org Team (custom-role) management ---

export interface SubOrgTeamListRequest {
    sub_org_id: string;
    institute_id: string;
    roles?: string[];
    status?: string[];
    name?: string;
    page_number?: number;
    page_size?: number;
}

export interface SubOrgTeamListResponse {
    content: Array<{
        userId: string;
        username?: string;
        fullName?: string;
        email?: string;
        mobileNumber?: string;
        roles?: Array<{ id: string; name: string; institute_id?: string; status?: string }>;
        [key: string]: unknown;
    }>;
    page_number: number;
    page_size: number;
    total_elements: number;
    total_pages: number;
    last: boolean;
    first: boolean;
}

export const listSubOrgTeamMembers = async (
    data: SubOrgTeamListRequest
): Promise<SubOrgTeamListResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: SUB_ORG_TEAM_LIST,
        data,
    });
    return response.data;
};

export interface SubOrgTeamAddRequest {
    sub_org_id: string;
    institute_id: string;
    user: {
        email: string;
        full_name: string;
        mobile_number?: string;
    };
    role_name: string;
    role_id?: string;
    package_session_ids: string[];
    access_permission?: string;
}

export interface SubOrgTeamAddResponse {
    user_id: string;
    granted_count: number;
}

export const addSubOrgTeamMember = async (
    data: SubOrgTeamAddRequest
): Promise<SubOrgTeamAddResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: SUB_ORG_TEAM_ADD,
        data,
    });
    return response.data;
};

export interface SubOrgTeamRemoveRequest {
    sub_org_id: string;
    institute_id: string;
    user_id: string;
    /** SOFT = keep access until access_till_date, HARD = deactivate now. Defaults HARD. */
    mode?: 'SOFT' | 'HARD';
    /** SOFT-only last access date (ISO yyyy-MM-dd). Required for SOFT. */
    access_till_date?: string | null;
}

export const removeSubOrgTeamMember = async (
    data: SubOrgTeamRemoveRequest
): Promise<{
    user_id: string;
    sub_org_id: string;
    mode?: string;
    access_till_date?: string;
    deactivated_mappings?: number;
    scheduled_mappings?: number;
}> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: SUB_ORG_TEAM_REMOVE,
        data,
    });
    return response.data;
};

export interface AccessibleSubOrg {
    id: string;
    name: string;
}

export const listAccessibleSubOrgs = async (
    instituteId: string
): Promise<AccessibleSubOrg[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: SUB_ORG_TEAM_ACCESSIBLE,
        params: { instituteId },
    });
    return response.data;
};

export interface UserSubOrgLink {
    user_id: string;
    sub_orgs: AccessibleSubOrg[];
}

/** For each user linked (via FSPSSM) to a sub-org the caller can see, the list of those
 *  sub-orgs. Scoped server-side to the caller (real admin → all; sub-org admin → their own).
 *  Drives the "Sub-Orgs" column + filter on the institute Teams list. */
/**
 * Grant an EXISTING institute user access to a channel partner.
 *
 * Deliberately NOT `addSubOrgTeamMember`: that endpoint creates a person via auth-service
 * `/user-invitation/invite`, which can email somebody who already has an account. This one
 * only writes the access rows, so assigning from the Teams list is silent.
 *
 * Omitting package_session_ids grants every course the partner's active invites reach —
 * i.e. "assign them to the whole partner", which is what the Teams list action means.
 */
export const assignUserToSubOrg = async (body: {
    sub_org_id: string;
    institute_id: string;
    user_id: string;
    package_session_ids?: string[];
}): Promise<{
    user_id: string;
    sub_org_id: string;
    granted_count: number;
    already_had: number;
}> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${BASE_URL}/admin-core-service/sub-org/v1/team/assign`,
        data: body,
    });
    return response.data;
};

export const listUserSubOrgLinks = async (
    instituteId: string
): Promise<UserSubOrgLink[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: SUB_ORG_TEAM_USER_LINKS,
        params: { instituteId },
    });
    return response.data;
};

export interface AccessibleGrants {
    package_session_ids: string[];
}

/** Returns the caller's accessible package sessions for the Add Member form.
 *  Invite-level access is auto-linked server-side from the selected PSes — no client choice. */
export const listAccessibleGrants = async (
    instituteId: string
): Promise<AccessibleGrants> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: SUB_ORG_TEAM_ACCESSIBLE_GRANTS,
        params: { instituteId },
    });
    return response.data;
};

// --- Sub-Org Finance Detail (manage-sub-orgs detail panel) ---

export interface SubOrgInstallment {
    student_fee_payment_id: string;
    amount_expected: number;
    amount_paid: number;
    due_date?: string;
    status: string; // PENDING / PARTIAL_PAID / PAID / WAIVED / OVERDUE
}

export interface SubOrgAdminPayment {
    user_id?: string;
    full_name?: string;
    user_plan_id?: string;
    payment_type?: string;             // FREE / ONE_TIME / SUBSCRIPTION / CPO
    complex_payment_option_id?: string;
    user_plan_status?: string;
    start_date?: string;
    end_date?: string;
    total_amount?: number;
    paid_amount?: number;
    outstanding_amount?: number;
    installment_count?: number;
    pending_installments_count?: number;
    next_due?: SubOrgInstallment;
    installments?: SubOrgInstallment[];
}

export interface SubOrgLearnerRow {
    user_id: string;
    full_name?: string;
    package_session_id?: string;
    /** Every package session this learner is enrolled into under the sub-org. */
    package_session_ids?: string[];
    user_plan_id?: string;
    enrolled_date?: string;
    outstanding_amount?: number;
    pending_installments_count?: number;
    next_due?: SubOrgInstallment;
}

export interface SubOrgFinanceDetail {
    sub_org_id: string;
    sub_org_name?: string;
    admin_payment?: SubOrgAdminPayment;
    learners: SubOrgLearnerRow[];
    totals: {
        learner_count: number;
        total_outstanding: number;
    };
    seat_usage?: {
        used?: number;
        total?: number | null;
        remaining?: number | null;
    };
}

export const getSubOrgFinanceDetail = async (
    subOrgId: string,
    parentInstituteId?: string
): Promise<SubOrgFinanceDetail> => {
    const params: Record<string, string> = { subOrgId };
    if (parentInstituteId) params.parentInstituteId = parentInstituteId;
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_SUB_ORG_FINANCE_DETAIL,
        params,
    });
    return response.data;
};

// --- Sub-Org Team Pending Installments (manage-suborg-teams column) ---

export interface SubOrgTeamMemberInstallmentRow {
    user_id: string;
    outstanding_amount?: number;
    pending_installments_count?: number;
    total_installments?: number;
    next_due_date?: string;
    next_due_amount?: number;
    next_due_status?: string;
}

export interface SubOrgTeamPendingInstallments {
    sub_org_id: string;
    members: SubOrgTeamMemberInstallmentRow[];
}

export const getSubOrgTeamPendingInstallments = async (
    subOrgId: string,
    instituteId: string
): Promise<SubOrgTeamPendingInstallments> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: SUB_ORG_TEAM_PENDING_INSTALLMENTS,
        params: { subOrgId, instituteId },
    });
    return response.data;
};

// --- Invoices (per user) ---

export interface InvoiceSummary {
    id: string;
    invoiceNumber?: string;
    invoice_number?: string;
    totalAmount?: number;
    total_amount?: number;
    currency?: string;
    status?: string;
    invoice_date?: string;
    invoiceDate?: string;
    pdfUrl?: string;
    pdf_url?: string;
    /**
     * Server-stored S3 file id on the persisted Invoice row. When present (with no
     * `pdf_url`), the FE opens `/v1/invoices/{id}/download` which 302-redirects to a
     * freshly-presigned URL — matches the manage-students payment-history pattern.
     */
    pdf_file_id?: string;
    pdfFileId?: string;
    fileId?: string;
    file_id?: string;
    /**
     * Learner-facing pay page. Only populated by the backend when the invoice is
     * PENDING_PAYMENT and is a real Invoice row (synthetic SFP rows leave this null).
     * Drives the Copy Link button on the Invoices section.
     */
    payment_link?: string;
    paymentLink?: string;
    /**
     * Which creation flow generated this invoice:
     *   ADMIN_MANUAL         — institute admin created via the Create Invoice dialog
     *   USER_PLAN            — auto-generated when a learner subscribes / renews a plan
     *   STUDENT_FEE_PAYMENT  — CPO installment (real Invoice row linked to an SFP)
     * Drives source-specific action visibility in the Invoices tab.
     */
    source?: string | null;
    source_id?: string | null;
    /** Due date on the Invoice row (distinct from invoice_date). */
    due_date?: string | null;
    [key: string]: unknown;
}

/**
 * Re-send the payment-due reminder for a PENDING_PAYMENT admin invoice. Fires the
 * same in-app alert + email the creation flow uses, prefixed with "Reminder:" so
 * the learner can distinguish a follow-up from the original bill. Returns a per-
 * channel breakdown so the FE can toast precisely (e.g. "Reminder sent to X" vs
 * "Couldn't send email, but in-app alert delivered").
 */
export const sendInvoiceReminder = async (
    invoiceId: string
): Promise<{
    invoice_id: string;
    invoice_number: string;
    recipient_email?: string;
    email_sent: boolean;
    alert_sent: boolean;
    payment_link?: string;
}> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${BASE_URL}/admin-core-service/v1/invoices/${invoiceId}/send-reminder`,
    });
    return response.data;
};

/**
 * Record a manual / offline payment against a PENDING_PAYMENT admin invoice. The
 * backend creates a MANUAL PaymentLog, links it to the invoice, flips status to
 * PAID, and sends a best-effort confirmation email. Returns the updated invoice
 * row so the FE can swap the list entry in place.
 */
export const markInvoicePaidManually = async (
    invoiceId: string,
    body: { transaction_id?: string; notes?: string; payment_details?: OfflinePaymentDetails | null }
): Promise<InvoiceSummary> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${BASE_URL}/admin-core-service/v1/invoices/${invoiceId}/mark-paid-manual`,
        data: body,
    });
    return response.data;
};

/**
 * Record an offline payment against an existing sub-org admin's UserPlan. Same backend
 * endpoint manage-students uses (`CpoSideViewController.recordOfflinePayment`). Inlined
 * here so the sub-org call site is decoupled from the shared `POST_USER_PLAN_OFFLINE_PAYMENT`
 * constant other surfaces depend on.
 */
export const recordSubOrgAdminOfflinePayment = async (
    userPlanId: string,
    body: {
        amount: number;
        payment_date?: string;
        reference?: string | null;
        currency?: string;
        generate_invoice?: boolean;
        payment_details?: OfflinePaymentDetails | null;
    }
): Promise<unknown> => {
    const url = `${BASE_URL}/admin-core-service/v1/fee-management/user-plan/${userPlanId}/record-offline-payment`;
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url,
        data: body,
    });
    return response.data;
};

/**
 * Manually fire a single-SFP installment-due reminder via the workflow engine. Backend
 * resolves recipient (student or linked parent) + builds the same context shape the
 * scheduled job uses, so existing workflow templates work unchanged.
 */
export const triggerInvoiceReminderForSfp = async (
    sfpId: string
): Promise<{
    student_fee_payment_id: string;
    reminder_type: string;
    recipient_email: string;
}> => {
    const url = `${BASE_URL}/admin-core-service/v1/invoices/sfp/${sfpId}/send-reminder`;
    const response = await authenticatedAxiosInstance({ method: 'POST', url });
    return response.data;
};

export const getInvoicesByUser = async (userId: string): Promise<InvoiceSummary[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INVOICES_BY_USER(userId),
    });
    return Array.isArray(response.data) ? response.data : [];
};

/**
 * Force a browser save dialog for the invoice PDF.
 *
 * The URL we receive is a pre-signed S3 link (1-day TTL). Plain `<a download>` is a hint
 * only for cross-origin downloads and most browsers ignore it for S3, so we fetch the
 * PDF as a blob and trigger an in-page anchor click. If CORS blocks the fetch
 * (production-side S3 mis-config), we fall back to opening the URL in a new tab so the
 * user can still save from the browser PDF viewer.
 */
export const downloadInvoicePdf = async (url: string, filename: string): Promise<void> => {
    try {
        const resp = await fetch(url, { credentials: 'omit' });
        if (!resp.ok) throw new Error(`Invoice fetch ${resp.status}`);
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Give the browser a moment to start the download before revoking.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
};

/** Builds a stable filename for invoice downloads. */
export const buildInvoiceFilename = (invoice: InvoiceSummary): string => {
    const num =
        (invoice.invoice_number as string | undefined)
        || (invoice.invoiceNumber as string | undefined)
        || invoice.id;
    return `invoice-${num}.pdf`;
};
