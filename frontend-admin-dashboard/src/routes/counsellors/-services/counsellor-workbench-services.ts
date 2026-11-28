import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    COUNSELLOR_WORKBENCH_ACTIVITY,
    COUNSELLOR_WORKBENCH_CONFIG,
    COUNSELLOR_WORKBENCH_CONFIG_UPDATE,
    COUNSELLOR_WORKBENCH_COUNSELLOR_LEADS,
    COUNSELLOR_WORKBENCH_COUNSELLORS,
    COUNSELLOR_WORKBENCH_LEAD_TRANSFERS,
    COUNSELLOR_WORKBENCH_MY_LEADS,
    COUNSELLOR_WORKBENCH_MY_TEAM,
    COUNSELLOR_WORKBENCH_ASSIGN,
    COUNSELLOR_WORKBENCH_ASSIGN_PREVIEW,
    COUNSELLOR_WORKBENCH_REASSIGN,
    COUNSELLOR_WORKBENCH_REASSIGN_PREVIEW,
    COUNSELLOR_WORKBENCH_SET_STATUS,
} from '@/constants/urls';

/** Display-only team info; all fields are null for users without a team. */
export interface WorkbenchTeam {
    team_id: string | null;
    team_name: string | null;
    ancestor_names: string[] | null;
    descendant_team_ids: string[] | null;
}

export interface WorkbenchCounsellor {
    user_id: string;
    full_name: string | null;
    email: string | null;
    team_id: string | null;
    team_name: string | null;
    role_label: string | null;
    is_active: boolean;
    open_leads_count: number;
    rating: number | null;
    rating_strategy_type: string | null;
}

export interface WorkbenchLead {
    lead_id: string;
    user_id: string;
    lead_name: string | null;
    lead_email: string | null;
    lead_phone: string | null;
    conversion_status: string;
    lead_status_label: string | null;
    lead_tier: string | null;
    best_score: number | null;
    assigned_counselor_id: string | null;
    assigned_counselor_name: string | null;
    assigned_at: string | null;
    last_activity_at: string | null;
    campaign_name: string | null;
    source_type: string | null;
}

export interface ActivityFeedItem {
    id: string;
    source_table: 'telephony_call_log' | 'lead_followup' | 'timeline_event';
    action_type: string;
    lead_id: string | null;
    lead_name: string | null;
    title: string | null;
    description: string | null;
    metadata_json: string | null;
    created_at: string;
}

export interface ReassignAssignment {
    lead_id: string;
    to_user_id: string;
}

/** UNASSIGN is only valid for the bulk-assign flow (remove counsellor from
 *  the selected leads); the reassign flow's modes are the first three. */
export type ReassignMode = 'SINGLE' | 'ROUND_ROBIN' | 'MANUAL' | 'UNASSIGN';

export interface ReassignPayload {
    institute_id: string;
    from_user_id: string;
    mode: ReassignMode;
    target_user_id?: string;
    assignments?: ReassignAssignment[];
    // When true the source counsellor's pool memberships are flipped
    // INACTIVE in the same backend transaction as the reassignment commit.
    // Powers the reassign-first UI: confirming the dialog atomically moves
    // the leads AND takes the counsellor offline.
    mark_inactive?: boolean;
    /**
     * Optional scope filter. When set, the backend only moves these specific
     * leads (matched by user_lead_profile.id == WorkbenchLead.lead_id) instead
     * of the source counsellor's entire open-leads list. The per-row Reassign
     * button passes a single id here so clicking it doesn't drain the
     * counsellor's whole pipeline.
     */
    lead_ids?: string[];
    /** Move at most this many leads in this call; the response reports remaining_leads. */
    batch_size?: number;
    /** ROUND_ROBIN batches: leads already moved, so the rotation continues fairly. */
    rotation_offset?: number;
}

export interface ReassignResult {
    dry_run: boolean;
    total_leads: number;
    assignments: Array<{
        lead_id: string;
        lead_name: string | null;
        from_user_id: string;
        to_user_id: string;
        to_user_name: string | null;
    }>;
    marked_inactive?: boolean;
    /** Batched calls only: open leads still to move. 0 = done. */
    remaining_leads?: number | null;
}

export interface StatusChangeResponse {
    user_id: string;
    status: string;
    pools_affected: number;
    open_leads: WorkbenchLead[];
}

export interface WorkbenchConfig {
    institute_id: string;
    // Rating strategy fields — flattened on the wire, persisted inside
    // LEAD_SETTING.workbench.rating in the institute_setting JSON. (The old
    // leads_team_id config is gone — counsellors are role-defined.)
    strategy_type?: 'STATIC' | 'STRATEGY_BASED';
    starting_rating?: number;
    window_days?: number;
    success_status_keys?: string[];
    w_conversion?: number;
    w_velocity?: number;
    ideal_velocity_hours?: number;
    worst_velocity_hours?: number;
    min_sample_size?: number;
}

export async function fetchWorkbenchConfig(instituteId: string) {
    const res = await authenticatedAxiosInstance.get<WorkbenchConfig>(
        COUNSELLOR_WORKBENCH_CONFIG(instituteId)
    );
    return res.data;
}

export async function updateWorkbenchConfig(payload: WorkbenchConfig) {
    const res = await authenticatedAxiosInstance.put<WorkbenchConfig>(
        COUNSELLOR_WORKBENCH_CONFIG_UPDATE,
        payload
    );
    return res.data;
}

export async function fetchMyTeam(instituteId: string) {
    const res = await authenticatedAxiosInstance.get<WorkbenchTeam>(
        COUNSELLOR_WORKBENCH_MY_TEAM(instituteId)
    );
    return res.data;
}

// Mirrors org.springframework.data.domain.Page wire shape. Only the fields
// the UI actually consumes are typed — Spring emits a few more (`first`,
// `last`, `sort`, `pageable`, `numberOfElements`, `empty`) that we ignore.
export interface PaginatedResponse<T> {
    content: T[];
    totalElements: number;
    totalPages: number;
    size: number;
    number: number;
}

export async function fetchMyLeads(
    instituteId: string,
    status?: string,
    page: number = 0,
    size: number = 20
) {
    const res = await authenticatedAxiosInstance.get<PaginatedResponse<WorkbenchLead>>(
        COUNSELLOR_WORKBENCH_MY_LEADS(instituteId, status, page, size)
    );
    return res.data;
}

/**
 * Per-counsellor leads. Used by the CSO / manager detail drawer — the
 * /me/leads endpoint can't return someone else's leads since it's
 * auth-scoped to the caller.
 */
export async function fetchCounsellorLeads(
    instituteId: string,
    counsellorUserId: string,
    status?: string,
    page: number = 0,
    size: number = 50
) {
    const res = await authenticatedAxiosInstance.get<PaginatedResponse<WorkbenchLead>>(
        COUNSELLOR_WORKBENCH_COUNSELLOR_LEADS(instituteId, counsellorUserId, status, page, size)
    );
    return res.data;
}

/**
 * Role-based roster: every COUNSELLOR-role user the caller may see — their
 * hierarchy scope when the caller holds the COUNSELLOR role, institute-wide
 * for pure admins. Replaces the old team-based fetchTeamCounsellors.
 */
export async function fetchCounsellors(
    instituteId: string,
    opts?: {
        search?: string;
        status?: 'active' | 'inactive' | 'all';
        page?: number;
        size?: number;
        /** Resolve assignment TARGETS instead of the visibility roster:
         *  ADMIN-role callers get the institute-wide counsellor list even
         *  when they also hold COUNSELLOR (and are hierarchy-scoped in the
         *  display roster). Use for reassign/assign dropdowns only. */
        assignable?: boolean;
    }
) {
    const res = await authenticatedAxiosInstance.get<PaginatedResponse<WorkbenchCounsellor>>(
        COUNSELLOR_WORKBENCH_COUNSELLORS(
            instituteId,
            opts?.search,
            opts?.status,
            opts?.page,
            opts?.size,
            opts?.assignable
        )
    );
    return res.data;
}

export async function setCounsellorStatus(userId: string, instituteId: string, status: string) {
    const res = await authenticatedAxiosInstance.patch<StatusChangeResponse>(
        COUNSELLOR_WORKBENCH_SET_STATUS(userId),
        { institute_id: instituteId, status }
    );
    return res.data;
}

export async function previewReassign(payload: ReassignPayload) {
    const res = await authenticatedAxiosInstance.post<ReassignResult>(
        COUNSELLOR_WORKBENCH_REASSIGN_PREVIEW,
        payload
    );
    return res.data;
}

export async function commitReassign(payload: ReassignPayload) {
    const res = await authenticatedAxiosInstance.post<ReassignResult>(
        COUNSELLOR_WORKBENCH_REASSIGN,
        payload
    );
    return res.data;
}

// ── Bulk assign a selected set of leads (multi-select in the leads list) ──

export interface AssignLeadsAssignment {
    user_id: string;
    to_user_id: string;
}

export interface AssignLeadsPayload {
    institute_id: string;
    /** Lead user ids to assign (WorkbenchLead/campaign-user user_id values). */
    user_ids: string[];
    mode: ReassignMode;
    /** SINGLE mode. */
    target_user_id?: string;
    /** ROUND_ROBIN participants. Omit to use all active counsellors in scope. */
    candidate_user_ids?: string[];
    /** MANUAL mode. */
    assignments?: AssignLeadsAssignment[];
}

export interface AssignLeadsResult {
    dry_run: boolean;
    total_leads: number;
    assignments: Array<{
        user_id: string;
        to_user_id: string;
        to_user_name: string | null;
    }>;
}

export async function previewAssignLeads(payload: AssignLeadsPayload) {
    const res = await authenticatedAxiosInstance.post<AssignLeadsResult>(
        COUNSELLOR_WORKBENCH_ASSIGN_PREVIEW,
        payload
    );
    return res.data;
}

export async function assignLeads(payload: AssignLeadsPayload) {
    const res = await authenticatedAxiosInstance.post<AssignLeadsResult>(
        COUNSELLOR_WORKBENCH_ASSIGN,
        payload
    );
    return res.data;
}

export async function fetchActivityFeed(
    userId: string,
    instituteId: string,
    fromMillis?: number,
    toMillis?: number,
    limit: number = 50
) {
    const res = await authenticatedAxiosInstance.get<ActivityFeedItem[]>(
        COUNSELLOR_WORKBENCH_ACTIVITY(userId, instituteId, fromMillis, toMillis, limit)
    );
    return res.data;
}

/**
 * One row in a lead's counsellor-assignment chain. The very first row has
 * `from_user_id === null` (initial assignment, nobody handed it off). Names
 * are server-hydrated from auth_service; fall back to the user_id when the
 * hydration call failed and the name came back null.
 */
export interface LeadTransfer {
    from_user_id: string | null;
    from_name: string | null;
    to_user_id: string;
    to_name: string | null;
    actor_id: string | null;
    actor_name: string | null;
    /** Workbench tag: WORKBENCH_REASSIGN, POOL_ASSIGNMENT, etc. */
    trigger: string | null;
    /** Reassign mode tag: SINGLE / ROUND_ROBIN / MANUAL. Null for non-workbench assigns. */
    mode: string | null;
    /** ISO timestamp. */
    at: string;
}

/**
 * Fetch a lead's full transfer chain (oldest → newest). RBAC is enforced
 * server-side: the lead's current assignee must be in the caller's
 * descendant set, otherwise the server returns an error.
 */
export async function fetchLeadTransfers(instituteId: string, leadUserId: string) {
    const res = await authenticatedAxiosInstance.get<LeadTransfer[]>(
        COUNSELLOR_WORKBENCH_LEAD_TRANSFERS(instituteId, leadUserId)
    );
    return res.data;
}
