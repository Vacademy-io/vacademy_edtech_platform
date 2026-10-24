import { GET_CAMPAIGN_USERS } from '@/constants/urls';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import type { LeadCustomFieldFilter } from './get-lead-custom-field-values';

export interface CampaignLeadUser {
    response_id?: string;
    audience_id?: string;
    campaign_name?: string;
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
        username?: string;
        email?: string;
        full_name?: string;
        address_line?: string;
        city?: string;
        region?: string;
        pin_code?: string;
        mobile_number?: string;
        date_of_birth?: string;
        gender?: string;
        roles?: string[];
        last_login_time?: string;
        root_user?: boolean;
    };
    custom_field_values?: Record<string, string>;
    custom_field_metadata?: Record<string, unknown>;
    // ── TAT / Follow-up SLA (deadlines + badge; visual only) ──
    tat_due_at?: string | null;
    /** True when an admin set tat_due_at by hand. */
    tat_due_overridden?: boolean | null;
    /** This enquiry repeats an existing lead (flagged by repeat-lead handling). */
    is_duplicate?: boolean | null;
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
}

export interface CampaignLeadsResponse {
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
    first: boolean;
    last: boolean;
    content: CampaignLeadUser[];
}

/**
 * @deprecated Use {@link LeadCustomFieldFilter} ({field_id, values[]}). Kept as a
 * re-export so existing imports keep resolving.
 */
export type CustomFieldFilter = LeadCustomFieldFilter;

export interface CampaignLeadsRequest {
    audience_id: string;
    source_type?: string;
    source_id?: string;
    // Backend `LeadFilterDTO` uses snake_case `submitted_from_local` /
    // `submitted_to_local`. The earlier non-`_local` fields were silently
    // ignored — keep the field names aligned with the DTO.
    submitted_from_local?: string;
    submitted_to_local?: string;
    // Substring match across parent_name / parent_email / parent_mobile.
    search_query?: string;
    // Lead tier key(s) from the institute's lead_tier catalog (HOT/WARM/COLD by default), comma-separated. Omitted = all tiers.
    lead_tier?: string;
    // Custom pipeline status filter — lead_status.id. Omitted = all statuses.
    lead_status_id?: string;
    // Per-custom-field filters. Each entry narrows the result to responses
    // whose custom_field_values row matches ({field_id, one of values}). Within
    // an entry the values are OR-combined; across entries the backend
    // AND-combines them.
    custom_field_filters?: LeadCustomFieldFilter[];
    // Campaign (UTM) attribution filter — same wire shape on every list
    // surface; see services/utm-list-filters.
    utm_filters?: import('@/services/utm-list-filters').UtmListFiltersPayload;
    // Conversion-state filter:
    //   undefined / 'EXCLUDE_CONVERTED' → hide leads who've been assigned to a course
    //   'ONLY_CONVERTED'                → only show those leads
    //   'ALL'                           → show every lead regardless of state
    conversion_status_filter?: 'EXCLUDE_CONVERTED' | 'ONLY_CONVERTED' | 'ALL';
    /** Call-attempt history filter ('' | NOT_CALLED | CALLED | CALLED_ONCE | CALLED_TWICE_PLUS | AI_CALLED | MANUAL_CALLED). */
    call_history_filter?: string;
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
    page: number;
    size: number;
    sort_by?: string;
    sort_direction?: string;
}

export const fetchCampaignLeads = async (
    payload: CampaignLeadsRequest
): Promise<CampaignLeadsResponse> => {
    try {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const response = await fetch(`${GET_CAMPAIGN_USERS}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                audience_id: payload.audience_id,
                source_type: payload.source_type,
                source_id: payload.source_id,
                submitted_from_local: payload.submitted_from_local,
                submitted_to_local: payload.submitted_to_local,
                search_query: payload.search_query,
                lead_tier: payload.lead_tier,
                lead_status_id: payload.lead_status_id,
                custom_field_filters: payload.custom_field_filters,
                utm_filters: payload.utm_filters,
                conversion_status_filter: payload.conversion_status_filter,
                call_history_filter: payload.call_history_filter,
                sla_filter: payload.sla_filter,
                assigned_counselor_id: payload.assigned_counselor_id,
                is_unassigned: payload.is_unassigned,
                sort_by: payload.sort_by,
                sort_direction: payload.sort_direction,
                page: payload.page,
                size: payload.size,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error fetching campaign leads:', error);
        throw error;
    }
};

export const handleFetchCampaignUsers = (payload: CampaignLeadsRequest) => {
    return {
        queryKey: [
            'campaignUsers',
            payload.audience_id,
            payload.page,
            payload.size,
            payload.sort_by,
            payload.sort_direction,
            payload.source_type,
            payload.source_id,
            payload.submitted_from_local,
            payload.submitted_to_local,
            payload.search_query,
            payload.lead_tier,
            // Must be in the key: picking a specific catalog status sets
            // lead_status_id while conversion_status_filter stays 'ALL', so
            // without this the key wouldn't change and React Query would serve
            // the cached list — the status filter would fire no request.
            payload.lead_status_id ?? '',
            payload.conversion_status_filter ?? 'EXCLUDE_CONVERTED',
            payload.call_history_filter ?? '',
            payload.sla_filter ?? '',
            payload.assigned_counselor_id ?? '',
            payload.is_unassigned ?? false,
            // Stable cache key for an order-independent set of custom-field
            // filters. The operator is part of the key — "Empty" vs "Has any
            // value" on the same field both serialize to empty values, and
            // without the operator they'd collide and serve each other's
            // cached page.
            payload.custom_field_filters
                ? payload.custom_field_filters
                      .map(
                          (f) =>
                              `${f.field_id}:${f.operator ?? 'IN'}=${[...f.values].sort().join(',')}`
                      )
                      .sort()
                      .join('|')
                : '',
            payload.utm_filters ? JSON.stringify(payload.utm_filters) : '',
        ],
        queryFn: () => fetchCampaignLeads(payload),
        staleTime: 60 * 1000, // 1 minute
    };
};
