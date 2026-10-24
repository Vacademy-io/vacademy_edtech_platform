import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { COMPLETED_LEAD_FOLLOWUPS } from '@/constants/urls';
import type { UtmListFiltersPayload } from '@/services/utm-list-filters';

/**
 * Completed follow-ups — one row per closed follow-up, newest first.
 *
 * Deliberately NOT the leads endpoint the other buckets use. A counsellor who
 * rings a lead today and books the next call for Friday closes one follow-up
 * and opens another; that lead belongs in this list for the call that happened
 * and in Upcoming for the one that has not. Listing leads here would show it as
 * finished while Friday is still open.
 */

export interface CompletedFollowUp {
    id: string;
    audience_response_id: string;
    schedule_time: string | null;
    closed_at: string | null;
    closed_by: string | null;
    closer_reason: string | null;
    content: string | null;
    /** Only populated for institutes that turned the follow-up fields on
     *  (Settings -> Lead settings -> Follow-up fields); null everywhere else. */
    student_response: string | null;
    follow_up_mode: string | null;
    next_action: string | null;
    interest_level?: string | null;
    created_at?: string | null;
    lead_name: string | null;
    lead_mobile: string | null;
    lead_user_id: string | null;
    /** Hydrated only on this endpoint — a completed follow-up is the only view of
     *  the lead the row gets, so it has to stand on its own. */
    lead_email: string | null;
    lead_source: string | null;
    lead_status: string | null;
    lead_tier: string | null;
    assigned_counselor_name: string | null;
    /** Form answers keyed by custom_field_id, same shape as the leads endpoint. */
    custom_field_values?: Record<string, string | null>;
    custom_field_metadata?: Record<
        string,
        { fieldName?: string; field_name?: string; fieldType?: string; field_type?: string }
    >;
}

export interface CompletedFollowUpsPage {
    content: CompletedFollowUp[];
    totalElements: number;
    totalPages: number;
    last: boolean;
}

export async function fetchCompletedFollowUps(params: {
    instituteId: string;
    counsellorUserId?: string;
    /** Name, phone or email. Matched the same way the leads list matches it. */
    search?: string;
    /** closed_at window, ISO instants. Both optional — omit for all time. */
    closedFrom?: string;
    closedTo?: string;
    /** Lead status keys, comma-separated — the sidebar route's `status`. */
    leadStatusId?: string;
    /** Same, but "every lead except these" (`statusExclude=1`). */
    leadStatusExcludeId?: string;
    /** The page's Source / Label filters, resolved to audience ids. */
    audienceIds?: string[];
    /** UTM selection, in the shape the leads query takes it. */
    utmFilters?: UtmListFiltersPayload;
    /** Interest levels recorded on the follow-up. */
    interestLevels?: string[];
    page: number;
    size: number;
    /**
     * Ask for the lead's email, source, status, interest level, owner and custom
     * fields on every row. Off by default — the table reads none of them and the
     * tile's count probe reads only the total, so switching it on there would cost
     * four server-side queries per page load for data nobody renders. The CSV
     * export sets it, because a row there is read on its own.
     */
    includeLeadDetail?: boolean;
}): Promise<CompletedFollowUpsPage | undefined> {
    // With the page's lead filters on, POST them as a body: a Source can resolve
    // to 100+ audience ids, too long for a URL. Without them, the original GET.
    const filtered =
        !!params.audienceIds?.length || !!params.utmFilters || !!params.interestLevels?.length;
    if (filtered) {
        const res = await authenticatedAxiosInstance.post(COMPLETED_LEAD_FOLLOWUPS, {
            institute_id: params.instituteId,
            counsellor_user_id: params.counsellorUserId,
            search: params.search || undefined,
            closed_from: params.closedFrom,
            closed_to: params.closedTo,
            lead_status_id: params.leadStatusId,
            lead_status_exclude_id: params.leadStatusExcludeId,
            audience_ids: params.audienceIds?.length ? params.audienceIds : undefined,
            utm_filters: params.utmFilters,
            interest_levels: params.interestLevels?.length ? params.interestLevels : undefined,
            page: params.page,
            size: params.size,
            include_lead_detail: params.includeLeadDetail || undefined,
        });
        return res?.data;
    }
    const res = await authenticatedAxiosInstance.get(COMPLETED_LEAD_FOLLOWUPS, {
        params: {
            instituteId: params.instituteId,
            counsellorUserId: params.counsellorUserId,
            search: params.search || undefined,
            closedFrom: params.closedFrom,
            closedTo: params.closedTo,
            leadStatusId: params.leadStatusId,
            leadStatusExcludeId: params.leadStatusExcludeId,
            page: params.page,
            size: params.size,
            includeLeadDetail: params.includeLeadDetail || undefined,
        },
    });
    return res?.data;
}
