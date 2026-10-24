import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_AUDIENCE_LEAD_BY_RESPONSE_ID, GET_CAMPAIGN_USERS } from '@/constants/urls';
import type { LeadCustomFieldFilter } from './get-lead-custom-field-values';

// The backend endpoint POST /admin-core-service/v1/audience/leads accepts a
// `LeadFilterDTO`. When `audience_id` is omitted it returns leads across every
// audience for the supplied `institute_id` — which is what the cross-audience
// "Recent Leads" view wants.

export interface RecentLeadDetail {
    response_id?: string;
    audience_id?: string;
    campaign_name?: string;
    /** The audience's campaign type — the channel the lead came in through. */
    campaign_type?: string;
    /** Latest UTM tagging on this lead. */
    utm_source?: string;
    utm_campaign?: string;
    user_id?: string;
    source_type?: string;
    source_id?: string;
    submitted_at_local?: string;
    parent_name?: string;
    parent_email?: string;
    parent_mobile?: string;
    source_audience_name?: string;
    user?: {
        id?: string;
        full_name?: string;
        email?: string;
        mobile_number?: string;
    };
    /** Form answers indexed by custom_field_id. */
    custom_field_values?: Record<string, string | null>;
    /** Field metadata keyed by custom_field_id (name + type). */
    custom_field_metadata?: Record<
        string,
        { fieldName?: string; field_name?: string; fieldType?: string; field_type?: string }
    >;
    // ── TAT / Follow-up SLA (deadlines + badge; visual only) ──
    tat_due_at?: string | null;
    /** True when an admin set tat_due_at by hand. */
    tat_due_overridden?: boolean | null;
    /** This enquiry repeats an existing lead (flagged by repeat-lead handling). */
    is_duplicate?: boolean | null;
    /** Live duplicate enquiries that repeat this lead; absent when there are none. */
    duplicate_count?: number | null;
    /** Open priority follow-up (opened for a reattempt). */
    follow_up_priority?: boolean | null;
    /** First time the assigned counselor acted — drives "Responded in N" in the Reach-out-by cell. */
    first_response_at?: string | null;
    /** Follow-up deadline = last counselor action + followUpSlaHours (null until acted). */
    follow_up_due_at?: string | null;
    tat_reminder_stage?: string | null;
    tat_overdue?: boolean | null;
    tat_due_soon?: boolean | null;
    follow_up_overdue?: boolean | null;
    /** Lead is Lost / Converted: off the SLA clock, so no Pending / Overdue. */
    sla_closed?: boolean | null;
    /** Custom pipeline status (enquiry_status), e.g. NEW / INTERESTED. */
    lead_status?: string | null;
    /** Interest level. The tier stored on the lead profile, falling back to the one
     *  derived from the score — the same precedence the lead tables render. */
    lead_tier?: string | null;
    /** Lead owner. Resolved from the linked enquiry, else from the lead profile. */
    assigned_counselor_id?: string | null;
    assigned_counselor_name?: string | null;
    // ── The next scheduled follow-up's own fields (what the counsellor wrote) ──
    follow_up_content?: string | null;
    follow_up_student_response?: string | null;
    follow_up_mode?: string | null;
    follow_up_next_action?: string | null;
    /** Interest level on that same open follow-up. */
    follow_up_interest_level?: string | null;
}

export interface RecentLeadsResponse {
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
    first: boolean;
    last: boolean;
    content: RecentLeadDetail[];
}

export interface RecentLeadsRequest {
    institute_id: string;
    // When set, the backend's `findLeadsWithFilters` runs scoped to this
    // audience. When omitted, `findInstituteLeadsWithFilters` returns leads
    // across every audience for the institute. Both default to submitted_at DESC
    // and honor sort_by/sort_direction below.
    audience_id?: string;
    /**
     * Multi-select audience filter (Recent Leads "All audiences" dropdown). The
     * backend narrows the institute-wide listing to these campaigns. Send this
     * INSTEAD of `audience_id` when more than one audience is picked — a lone id
     * is better sent as `audience_id`, which routes to the per-campaign query.
     * Omitted/empty = every audience the caller can see.
     */
    audience_ids?: string[];
    submitted_from_local?: string; // ISO-8601 timestamp
    submitted_to_local?: string;
    // Substring match against parent_name / parent_email / parent_mobile.
    search_query?: string;
    // Lead tier key(s) from the institute's lead_tier catalog (HOT/WARM/COLD by default), comma-separated. Omitted = all tiers.
    lead_tier?: string;
    // Custom pipeline status filter — lead_status.id. Omitted = all statuses.
    lead_status_id?: string;
    /** Status keys to EXCLUDE, comma separated. Mutually exclusive with lead_status_id. */
    lead_status_exclude_id?: string;
    /** EXCLUDE = hide enquiries flagged as duplicates; ONLY = just those. Omitted = no filter. */
    duplicate_filter?: 'EXCLUDE' | 'ONLY';
    /** Follow-ups page: only leads carrying an OPEN, scheduled follow-up… */
    follow_up_pending?: boolean;
    /** …and, optionally, only those whose follow-up falls in this window. The caller sends
     *  it because "today" is the user's day, not the server's. */
    follow_up_from?: string;
    follow_up_to?: string;
    /** Follow-ups page: only leads whose OPEN follow-up has one of these interest levels. */
    follow_up_interest_levels?: string[];
    // Conversion-state filter — defaults to EXCLUDE_CONVERTED on the backend so
    // leads that have been enrolled into a course don't pollute the active list.
    conversion_status_filter?: 'EXCLUDE_CONVERTED' | 'ONLY_CONVERTED' | 'ALL';
    /** Call-attempt history filter (see CallHistoryFilter options). */
    call_history_filter?: string;
    /** Attempt count N — only read when call_history_filter is CALLED_N_TIMES
     *  ("exactly N") or CALLED_N_PLUS_TIMES ("N or more"). Omitted otherwise. */
    call_count_value?: number;
    /**
     * "Worked in the last N" windows — ISO-8601 instants, open-ended at the top.
     *
     * Deliberately separate from submitted_from/to_local, which bound when the lead
     * ARRIVED. These bound when the COUNSELLOR last touched it, which is the question
     * "how many did I call / work in the last 24h" actually asks:
     *   called_from_local   -> last telephony_call_log entry for the lead
     *   activity_from_local -> last timeline_event (note, call log, status change,
     *                          follow-up) — the same feed the Activity column shows
     * A lead never called / never touched is excluded once the matching bound is set.
     */
    called_from_local?: string;
    called_to_local?: string;
    activity_from_local?: string;
    activity_to_local?: string;
    /**
     * Soft-delete visibility — defaults to EXCLUDE_DELETED on the backend, so deleted leads stay
     * hidden unless explicitly asked for. ONLY_DELETED backs the "Deleted leads" view that restore
     * is driven from.
     */
    audience_status_filter?: 'EXCLUDE_DELETED' | 'ONLY_DELETED' | 'ALL';
    /** Filter by SLA stage (the badge shown in the table). 'ANY_OVERDUE' = TAT_OVERDUE OR FOLLOW_UP_OVERDUE. */
    sla_filter?:
        | 'TAT_BEFORE'
        | 'TAT_OVERDUE'
        | 'FOLLOW_UP_DUE'
        | 'FOLLOW_UP_OVERDUE'
        | 'ANY_OVERDUE';
    /** Filter leads by the assigned counsellor's userId. Matches against
     *  linked_users (ENQUIRY source) first, falls back to user_lead_profile.
     *  Omitted = all counsellors (and unassigned leads). */
    assigned_counselor_id?: string;
    /** When true, returns ONLY leads with no owner on either linked_users or
     *  user_lead_profile (the "Unassigned" entry in the counsellor dropdown).
     *  Mutually exclusive with assigned_counselor_id. Omitted = no narrowing. */
    is_unassigned?: boolean;
    /** Filter by lead source — WEBSITE / META / GOOGLE / ORGANIC / … Maps to
     *  LeadFilterDTO.sourceType. Omitted = all sources. */
    source_type?: string;
    /** Per-custom-field filters. Each entry narrows results to leads whose
     *  custom_field_values row for {field_id} matches one of {values} (OR within
     *  the entry); across entries the backend AND-combines them. Omitted = none. */
    custom_field_filters?: LeadCustomFieldFilter[];
    /** Campaign (UTM) attribution filter — same wire shape on every list
     *  surface; see services/utm-list-filters. Omitted = none. */
    utm_filters?: import('@/services/utm-list-filters').UtmListFiltersPayload;
    /** Column to sort by — SUBMITTED_AT (default) | LEAD_SCORE | LEAD_TIER | STATUS. */
    sort_by?: string;
    sort_direction?: 'ASC' | 'DESC';
    page: number;
    size: number;
}

export const fetchRecentLeads = async (
    payload: RecentLeadsRequest
): Promise<RecentLeadsResponse> => {
    const { data } = await authenticatedAxiosInstance.post<RecentLeadsResponse>(
        GET_CAMPAIGN_USERS,
        payload
    );
    return data;
};

export const audienceLeadKey = (responseId: string) => ['audience-lead', responseId] as const;

/**
 * One lead by audience-response id, in the same {@link RecentLeadDetail} shape the
 * list returns. For surfaces that hold a response id but never loaded a lead row —
 * the Call Log, whose rows are calls — so they can feed the shared side-sheet
 * mapper (`mapRecentLeadToStudent`) the same object the leads lists feed it, rather
 * than a hand-rolled stub that leaves the Lead Profile tab without form answers.
 */
export const fetchAudienceLeadByResponseId = async (
    responseId: string
): Promise<RecentLeadDetail> => {
    const { data } = await authenticatedAxiosInstance.get<RecentLeadDetail>(
        GET_AUDIENCE_LEAD_BY_RESPONSE_ID(responseId)
    );
    return data;
};
