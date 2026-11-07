package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;

/**
 * DTO for filtering leads/responses
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadFilterDTO {

    private String audienceId;
    /**
     * Multi-select variant of {@link #audienceId} — narrows the cross-audience
     * (institute-wide) listing to these campaigns. Used by the Recent Leads
     * "All audiences" dropdown, which lets a counsellor pick several lists at
     * once. A single id here behaves exactly like audienceId (the service
     * collapses it onto the per-campaign query so source/dedup filters still
     * apply); two or more stay on the institute-wide query with an
     * audience_id IN (...) predicate. Requires instituteId. Null/empty = all
     * audiences, as before.
     */
    private java.util.List<String> audienceIds;
    private String instituteId;
    private String sourceType; // WEBSITE, GOOGLE_ADS, WALK_IN, etc.
    private String sourceId;
    private Timestamp submittedFromLocal;
    private Timestamp submittedToLocal;

    // ── "Worked in the last N days" windows ──
    // Deliberately separate from submittedFrom/To: that pair answers when the lead
    // ARRIVED, while counsellors want to know what they have touched recently
    // ("how many did I call in the last 24h / 7d"). Two independent windows so the
    // two questions stay answerable on their own:
    //   called*   -> last telephony_call_log entry for the lead (response, LEAD
    //                subject, or institute-scoped user link -- the same three
    //                linkages callHistoryFilter matches on).
    //   activity* -> last timeline_event for the lead (note, call log, status
    //                change, follow-up) -- the same feed the Activity column shows,
    //                so filtering and sorting it agree.
    // A lead never called / never touched is excluded as soon as the matching
    // window has either bound set.
    private Timestamp calledFromLocal;
    private Timestamp calledToLocal;
    private Timestamp activityFromLocal;
    private Timestamp activityToLocal;

    // ── Lead Score Filters ──
    private Integer minLeadScore;           // Filter leads with score >= this
    private Integer maxLeadScore;           // Filter leads with score <= this
    private String leadTier;                // HOT / WARM / COLD

    // ── Counselor Filters ──
    private String assignedCounselorId;     // Filter by assigned counselor
    private Boolean isUnassigned;           // True = only unassigned leads

    // ── Pipeline status filter ──
    // Comma-separated lead_status.status_key values (matched against the catalog key,
    // falling back to user_lead_profile.conversion_status for legacy leads). The
    // sentinel __NO_STATUS__ additionally matches leads with no status at all
    // (lead_status_id NULL and no profile conversion_status) - the "No status"
    // column on the Lead Board.
    private String leadStatusId;
    /**
     * Status keys to EXCLUDE, comma separated. Lets a saved view say "everything except New"
     * instead of listing the other nine statuses, so it keeps working when a status is added.
     * A lead with no status at all is never excluded.
     */
    private String leadStatusExcludeId;

    /**
     * Follow-ups page. {@code followUpPending} narrows to leads carrying an OPEN, scheduled
     * follow-up; the two bounds then slice that into the page's buckets. The caller sends the
     * window because "today" is the USER's day — computing it from NOW() here would put an
     * Asia/Calcutta counsellor in the wrong bucket for five and a half hours every night.
     */
    private Boolean followUpPending;
    private Timestamp followUpFrom;
    private Timestamp followUpTo;
    /**
     * Follow-ups page: keep only leads whose OPEN follow-up carries one of these
     * interest levels (lead_followup.interest_level, the institute's own labels).
     * Null / empty = no filter.
     */
    private java.util.List<String> followUpInterestLevels;

    // ── Status Filters ──
    private java.util.List<String> overallStatuses;    // ENQUIRY, APPLICATION, ADMITTED, etc.
    private java.util.List<String> enquiryStatuses;     // ACTIVE, CONVERTED, etc.

    // ── Dedup Filter ──
    private Boolean excludeDuplicates;      // True = hide duplicates (default behavior)
    /**
     * EXCLUDE = hide enquiries flagged as duplicates of a lead they repeat, ONLY = just those
     * (a Duplicate Leads tab). Null = no filter. Driven by the sidebar route, per tab.
     */
    private String duplicateFilter;

    // ── Search ──
    private String searchQuery;             // Searches parent name, email, mobile

    // ── Conversion-status filter ──
    // 'EXCLUDE_CONVERTED' (default) hides leads whose user_lead_profile.conversion_status
    // is CONVERTED — assignments to a course flip a lead to that state, and we
    // don't want them cluttering the active-leads view by default.
    // 'ONLY_CONVERTED' shows only converted leads. 'ALL' shows everything.
    private String conversionStatusFilter;
    /** Call-attempt history: '' | NOT_CALLED | CALLED | CALLED_ONCE | CALLED_TWICE_PLUS
     *  | CALLED_N_TIMES | CALLED_N_PLUS_TIMES | AI_CALLED | MANUAL_CALLED. Matched via
     *  telephony_call_log by response_id, LEAD subject_id, OR institute-scoped user_id
     *  (CDR-imported calls often carry only the user link — same lookup the lead
     *  side-panel's call history uses).
     *  AI = VACADEMY_AI/AAVTAAR; manual = everything else bar MOCK. */
    private String callHistoryFilter;

    /**
     * Attempt count for the CALLED_N_TIMES ("called exactly N times") and
     * CALLED_N_PLUS_TIMES ("called N or more times") variants of
     * {@link #callHistoryFilter} — the arbitrary-N generalisation of the fixed
     * CALLED_ONCE / CALLED_TWICE_PLUS options. Ignored by every other filter value.
     * Null or &lt; 1 falls back to 1, so a missing value degrades to the CALLED_ONCE /
     * CALLED semantics instead of silently matching nothing.
     */
    private Integer callCountValue;

    /**
     * Soft-delete visibility: EXCLUDE_DELETED (default) | ONLY_DELETED | ALL.
     * Null/blank behaves as EXCLUDE_DELETED, so deleted leads stay hidden unless asked for —
     * ONLY_DELETED backs the "show deleted leads" view that restore is driven from.
     */
    private String audienceStatusFilter;

    // ── SLA-state filter ──
    // Filters by audience_response.tat_reminder_stage — the stage the SLA scheduler last
    // emitted for the lead. Same values shown in the leads-table badges:
    //   TAT_BEFORE | TAT_OVERDUE | FOLLOW_UP_DUE | FOLLOW_UP_OVERDUE
    // Plus 'ANY_OVERDUE' which matches TAT_OVERDUE OR FOLLOW_UP_OVERDUE. Null/empty = no filter.
    private String slaFilter;

    // ── Custom-field filters ──
    // Each entry narrows the result set so a response only matches when there
    // is a {custom_field_id, value} row in custom_field_values for it whose
    // value is one of the entry's `values`. Within a single entry the values
    // are OR-combined (e.g. city = Pune OR Mumbai); across entries they are
    // AND-combined (city in {...} AND grade in {...}). Drives the multi-select
    // custom-field dropdowns on both the per-campaign Lead List and the
    // cross-campaign Recent Leads view; the candidate fields and their option
    // values come from the institute's custom_fields config / distinct stored
    // values.
    private java.util.List<CustomFieldFilter> customFieldFilters;

    // ── Campaign (UTM) attribution filter ──
    // Narrows to leads whose person has a recorded utm_attribution touch
    // matching every dimension sent (OR within a dimension, AND across), or —
    // with untagged_only — to leads with no touch at all. Resolved up-front
    // into a response-id set and intersected with the custom-field match set,
    // so the native queries below are untouched. See UtmListFilterDTO.
    private vacademy.io.admin_core_service.features.utm_attribution.dto.UtmListFilterDTO utmFilters;

    // Pagination
    private Integer page;
    private Integer size;
    private String sortBy;                  // SUBMITTED_AT, LEAD_SCORE, LEAD_TIER, STATUS, PARENT_NAME,
                                            // LAST_ACTIVITY, LAST_CALLED, CUSTOM_FIELD
    private String sortDirection;           // ASC, DESC
    // When sortBy = CUSTOM_FIELD: the custom_field_id to sort by. The latest
    // AUDIENCE_RESPONSE-scoped answer per lead is the sort key — numeric-aware
    // (numeric-looking values order numerically, everything else as text),
    // rows without an answer sort last.
    private String sortCustomFieldId;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CustomFieldFilter {
        private String fieldId;
        // Optional operator: IN (default) | CONTAINS | IS_EMPTY | NOT_EMPTY |
        // BETWEEN | GTE | LTE. See CustomFieldListFilterDTO for semantics —
        // this mirrors that shared shape so every list surface accepts the
        // same payload.
        private String operator;
        // Selected values for this field (multi-select). A response matches the
        // field when ANY of these values is present (OR within the field).
        private java.util.List<String> values;
    }
}

