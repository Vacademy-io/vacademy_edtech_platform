package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.reports.calling.CallsByLeadResponseDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.calling.CallsDailyResponseDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.calling.CallsHeatmapResponseDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.calling.FollowupAgingResponseDTO;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Telephony + follow-up report aggregates for the Reports Center
 * (Calling and Follow-ups tabs): calls-daily, calls-heatmap, followup-aging.
 *
 * Raw JdbcTemplate SQL (SalesDashboardService pattern) — read-only, never
 * writes. Invariants honored here:
 *   - never JOIN users: names hydrated via the AuthService batch lookup;
 *   - call scoping is on telephony_call_log.counsellor_user_id directly;
 *   - follow-up scoping is on lead_followup.created_by (the counsellor who
 *     scheduled it — see {@code LeadFollowup});
 *   - timestamps are stored as UTC wall-clock in `timestamp` columns, so all
 *     day/hour bucketing is (col AT TIME ZONE 'UTC' AT TIME ZONE :tz) with the
 *     institute timezone from {@link LeadReportSettingService};
 *   - "connected" = institute-configurable status set (default ["COMPLETED"]);
 *   - RBAC scope CSV from {@link ReportScopeResolver}: null = no filter,
 *     "" matches nothing (zeroed report).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CallingReportService {

    private final NamedParameterJdbcTemplate jdbc;
    private final ReportScopeResolver reportScopeResolver;
    private final LeadReportSettingService leadReportSettingService;
    private final AuthService authService;

    /** Mirrors LeadReportService — last 30 days when from/to omitted. */
    private static final int DEFAULT_RANGE_DAYS = 30;
    private static final int CLOSURE_REASON_WINDOW_DAYS = 30;
    private static final ZoneId FALLBACK_ZONE = ZoneId.of("Asia/Kolkata");

    // ─────────────────────────────────────────────────────────────────────
    // SQL
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Shared call-population predicate. The window column is
     * COALESCE(start_time, created_at): start_time is null until the provider
     * ACKs the call, so created_at keeps just-initiated/failed dials in the
     * dial counts. Range params are UTC instants (institute-TZ day bounds
     * converted in Java).
     */
    private static final String CALL_WHERE = """
            FROM telephony_call_log tcl
            WHERE tcl.institute_id = :instituteId
              AND COALESCE(tcl.start_time, tcl.created_at) >= :fromUtc
              AND COALESCE(tcl.start_time, tcl.created_at) < :toUtc
              AND (:scopeCsv IS NULL OR tcl.counsellor_user_id = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
            """;

    private static final String CALLS_DAILY_SQL = """
            SELECT (COALESCE(tcl.start_time, tcl.created_at) AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day,
                   COUNT(*) AS dials,
                   COUNT(*) FILTER (WHERE tcl.status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS connected,
                   COALESCE(SUM(COALESCE(tcl.duration_seconds, 0))
                            FILTER (WHERE tcl.status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))), 0) AS talk_seconds
            """ + CALL_WHERE + """
            GROUP BY 1
            ORDER BY 1
            """;

    private static final String CALLS_BY_COUNSELLOR_SQL = """
            SELECT tcl.counsellor_user_id AS user_id,
                   COUNT(*) AS dials,
                   COUNT(*) FILTER (WHERE tcl.status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS connected,
                   COALESCE(SUM(COALESCE(tcl.duration_seconds, 0))
                            FILTER (WHERE tcl.status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))), 0) AS talk_seconds
            """ + CALL_WHERE + """
            GROUP BY tcl.counsellor_user_id
            ORDER BY dials DESC
            """;

    private static final String CALL_OUTCOMES_SQL = """
            SELECT tcl.counsellor_user_id AS user_id,
                   tcl.status AS status,
                   COUNT(*) AS n
            """ + CALL_WHERE + """
            GROUP BY tcl.counsellor_user_id, tcl.status
            ORDER BY tcl.counsellor_user_id, n DESC
            """;

    private static final String CALLS_HEATMAP_SQL = """
            SELECT EXTRACT(ISODOW FROM (COALESCE(tcl.start_time, tcl.created_at) AT TIME ZONE 'UTC' AT TIME ZONE :tz))::int AS dow,
                   EXTRACT(HOUR FROM (COALESCE(tcl.start_time, tcl.created_at) AT TIME ZONE 'UTC' AT TIME ZONE :tz))::int AS hour,
                   COUNT(*) AS dials,
                   COUNT(*) FILTER (WHERE tcl.status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS connected
            """ + CALL_WHERE + """
            GROUP BY 1, 2
            ORDER BY 1, 2
            """;

    /**
     * Shared lead-ownership scope arm for both calls-by-lead views. This report
     * is LEAD-centric, so the counsellor/team filter means "this counsellor's
     * leads" (COALESCE(linked_users, ulp.assigned_counselor_id) — same rule the
     * leads list applies), NOT "calls this counsellor dialled": attempts always
     * count every dial on the lead, whoever made it, so the numbers don't shrink
     * when a colleague or admin worked a lead. When the scope comes from caller
     * RBAC rather than an explicit picker, the unassigned pool stays visible
     * (:includeUnassigned) — mirroring AudienceResponseRepository's list rule.
     */
    private static final String LEAD_OWNER_SCOPE = """
              AND (:scopeCsv IS NULL
                   OR COALESCE(lu.user_id, ulp.assigned_counselor_id) = ANY(STRING_TO_ARRAY(:scopeCsv, ','))
                   OR (:includeUnassigned AND lu.user_id IS NULL AND ulp.assigned_counselor_id IS NULL))
            """;

    /**
     * Lead-wise base: every in-window dial joined to its lead. Calls are matched
     * by response_id with the user_id fallback for legacy rows (same rule as
     * SOURCE_PERFORMANCE_SQL); the audience join pins the fallback to THIS
     * institute's leads. subject_type guard keeps student/live-session calls out.
     */
    private static final String CALLS_BY_LEAD_BASE = """
            FROM telephony_call_log tcl
            JOIN audience_response ar
              ON (tcl.response_id = ar.id
                  OR (tcl.response_id IS NULL AND ar.user_id IS NOT NULL AND tcl.user_id = ar.user_id))
            JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId
            LEFT JOIN LATERAL (
                SELECT lu.user_id FROM linked_users lu
                WHERE lu.source = 'ENQUIRY' AND lu.source_id = ar.enquiry_id
                ORDER BY lu.created_at DESC LIMIT 1
            ) lu ON true
            LEFT JOIN user_lead_profile ulp
                ON ulp.user_id = ar.user_id AND ulp.institute_id = a.institute_id
            LEFT JOIN lead_status ls ON ls.id = ar.lead_status_id
            LEFT JOIN call_disposition_catalog cdc
              ON cdc.institute_id = tcl.institute_id AND cdc.disposition_key = tcl.disposition_key
            WHERE tcl.institute_id = :instituteId
              AND (tcl.subject_type IS NULL OR tcl.subject_type = 'LEAD')
              AND COALESCE(tcl.start_time, tcl.created_at) >= :fromUtc
              AND COALESCE(tcl.start_time, tcl.created_at) < :toUtc
              AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
            """ + LEAD_OWNER_SCOPE + """
              AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
              AND (:search IS NULL OR ar.parent_name ILIKE '%' || :search || '%'
                   OR ar.parent_mobile ILIKE '%' || :search || '%')
            """;

    /** Timestamps rendered in SQL: columns hold UTC wall-clock, so append Z verbatim. */
    private static final String ISO_UTC = "'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'";

    private static final String CALLS_BY_LEAD_ROWS_SQL = """
            SELECT ar.id AS response_id,
                   MAX(ar.user_id) AS user_id,
                   MAX(ar.parent_name) AS lead_name,
                   MAX(ar.parent_mobile) AS lead_phone,
                   MAX(ls.label) AS lead_status_label,
                   MAX(ls.color) AS lead_status_color,
                   COUNT(DISTINCT tcl.id) AS attempts,
                   COUNT(DISTINCT tcl.id) FILTER (WHERE tcl.status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS connected,
                   COUNT(DISTINCT tcl.id) FILTER (WHERE cdc.category = 'CALLBACK' OR tcl.callback_at IS NOT NULL) AS callbacks,
                   COUNT(DISTINCT tcl.id) FILTER (WHERE tcl.status IN ('NO_ANSWER', 'BUSY') OR cdc.category = 'NOT_CONNECTED') AS not_picked,
                   COUNT(DISTINCT tcl.id) FILTER (WHERE tcl.status IN ('FAILED', 'CANCELLED')) AS failed,
                   TO_CHAR(MAX(COALESCE(tcl.start_time, tcl.created_at)), """ + ISO_UTC + """
            ) AS last_call_at,
                   (ARRAY_AGG(tcl.status ORDER BY COALESCE(tcl.start_time, tcl.created_at) DESC))[1] AS last_call_status,
                   (ARRAY_AGG(tcl.disposition_key ORDER BY COALESCE(tcl.start_time, tcl.created_at) DESC)
                        FILTER (WHERE tcl.disposition_key IS NOT NULL))[1] AS last_disposition_key,
                   COALESCE(MAX(COALESCE(lu.user_id, ulp.assigned_counselor_id)),
                            (ARRAY_AGG(tcl.counsellor_user_id ORDER BY COALESCE(tcl.start_time, tcl.created_at) DESC)
                                 FILTER (WHERE tcl.counsellor_user_id IS NOT NULL))[1]) AS counsellor_user_id,
                   TO_CHAR(MIN(tcl.callback_at) FILTER (WHERE tcl.callback_at > NOW() AT TIME ZONE 'UTC'), """ + ISO_UTC + """
            ) AS next_callback_at
            """ + CALLS_BY_LEAD_BASE + """
            GROUP BY ar.id
            ORDER BY attempts DESC, MAX(COALESCE(tcl.start_time, tcl.created_at)) DESC
            LIMIT :limit OFFSET :offset
            """;

    private static final String CALLS_BY_LEAD_COUNT_SQL =
            "SELECT COUNT(DISTINCT ar.id) AS n " + CALLS_BY_LEAD_BASE;

    private static final String CALLS_BY_LEAD_SUMMARY_SQL = """
            SELECT COUNT(DISTINCT ar.id) AS leads_called,
                   COUNT(DISTINCT tcl.id) AS total_dials,
                   COUNT(DISTINCT ar.id) FILTER (WHERE tcl.status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS leads_connected,
                   COUNT(DISTINCT ar.id) FILTER (WHERE cdc.category = 'CALLBACK' OR tcl.callback_at IS NOT NULL) AS leads_callback
            """ + CALLS_BY_LEAD_BASE;

    /**
     * In-window new leads (submitted_at) with ZERO call attempts ever — the
     * never-called check is intentionally not date-bounded: one old dial means
     * the lead was worked. Same lead-ownership scope as the CALLED view.
     */
    private static final String UNCALLED_LEADS_BASE = """
            FROM audience_response ar
            JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId
            LEFT JOIN lead_status ls ON ls.id = ar.lead_status_id
            LEFT JOIN LATERAL (
                SELECT lu.user_id FROM linked_users lu
                WHERE lu.source = 'ENQUIRY' AND lu.source_id = ar.enquiry_id
                ORDER BY lu.created_at DESC LIMIT 1
            ) lu ON true
            LEFT JOIN user_lead_profile ulp
                ON ulp.user_id = ar.user_id AND ulp.institute_id = a.institute_id
            WHERE ar.submitted_at >= :fromUtc
              AND ar.submitted_at < :toUtc
              AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
            """ + LEAD_OWNER_SCOPE + """
              AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
              AND (:search IS NULL OR ar.parent_name ILIKE '%' || :search || '%'
                   OR ar.parent_mobile ILIKE '%' || :search || '%')
              AND NOT EXISTS (
                  SELECT 1 FROM telephony_call_log t2
                  WHERE t2.institute_id = :instituteId
                    AND (t2.response_id = ar.id
                         OR (t2.response_id IS NULL AND ar.user_id IS NOT NULL AND t2.user_id = ar.user_id))
              )
            """;

    private static final String UNCALLED_LEADS_ROWS_SQL = """
            SELECT ar.id AS response_id,
                   ar.user_id,
                   ar.parent_name AS lead_name,
                   ar.parent_mobile AS lead_phone,
                   """ + ReportSourceSql.effective("ar.source_type", "a.campaign_type") + """
                       AS source_type,
                   TO_CHAR(ar.submitted_at, """ + ISO_UTC + """
            ) AS submitted_at,
                   ls.label AS lead_status_label,
                   ls.color AS lead_status_color,
                   COALESCE(lu.user_id, ulp.assigned_counselor_id) AS counsellor_user_id
            """ + UNCALLED_LEADS_BASE + """
            ORDER BY ar.submitted_at DESC
            LIMIT :limit OFFSET :offset
            """;

    private static final String UNCALLED_LEADS_COUNT_SQL =
            "SELECT COUNT(*) AS n " + UNCALLED_LEADS_BASE;

    /**
     * Aging over OPEN follow-ups, point-in-time (no date window). d = calendar
     * days past due in the institute TZ: negative = upcoming, 0 = due today.
     * date - date is an integer in Postgres. Bands are disjoint: 1–3 / 4–7 / 8+.
     * Rows with a NULL schedule_time fall into no band by construction.
     * OPTED_OUT leads are excluded via the audience_response join.
     */
    private static final String FOLLOWUP_AGING_SQL = """
            SELECT t.user_id,
                   COUNT(*) FILTER (WHERE t.d < 0) AS upcoming,
                   COUNT(*) FILTER (WHERE t.d = 0) AS due_today,
                   COUNT(*) FILTER (WHERE t.d BETWEEN 1 AND 3) AS overdue_1_3,
                   COUNT(*) FILTER (WHERE t.d BETWEEN 4 AND 7) AS overdue_3_7,
                   COUNT(*) FILTER (WHERE t.d > 7) AS overdue_7_plus,
                   MAX(t.d) FILTER (WHERE t.d > 0) AS oldest_overdue_days
            FROM (
                SELECT lf.created_by AS user_id,
                       ((NOW() AT TIME ZONE :tz)::date
                        - (lf.schedule_time AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date) AS d
                FROM lead_followup lf
                JOIN audience_response ar ON ar.id = lf.audience_response_id
                WHERE lf.institute_id = :instituteId
                  AND lf.is_closed = false
                  AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
                  AND (:scopeCsv IS NULL OR lf.created_by = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
                  AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
            ) t
            GROUP BY t.user_id
            """;

    /**
     * closed_at is stamped by the close endpoint; COALESCE to updated_at as a
     * belt-and-braces for legacy rows flipped without a close timestamp.
     */
    private static final String CLOSURE_REASONS_SQL = """
            SELECT COALESCE(NULLIF(TRIM(lf.closer_reason), ''), '(no reason)') AS reason,
                   COUNT(*) AS n
            FROM lead_followup lf
            JOIN audience_response ar ON ar.id = lf.audience_response_id
            WHERE lf.institute_id = :instituteId
              AND lf.is_closed = true
              AND COALESCE(lf.closed_at, lf.updated_at) >= :closedSince
              AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
              AND (:scopeCsv IS NULL OR lf.created_by = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
              AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
            GROUP BY 1
            ORDER BY n DESC, reason ASC
            LIMIT 15
            """;

    // ─────────────────────────────────────────────────────────────────────
    // calls-daily
    // ─────────────────────────────────────────────────────────────────────

    public CallsDailyResponseDTO callsDaily(String instituteId, String fromDate, String toDate,
                                            String teamId, String counsellorUserId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = leadReportSettingService.get(instituteId);
        ZoneId tz = safeZone(settings);
        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        MapSqlParameterSource params = callParams(instituteId, fromDate, toDate, tz, settings, scopeCsv);

        List<CallsDailyResponseDTO.DayRow> days = jdbc.query(CALLS_DAILY_SQL, params, (rs, i) -> {
            long dials = rs.getLong("dials");
            long connected = rs.getLong("connected");
            return CallsDailyResponseDTO.DayRow.builder()
                    .date(rs.getDate("day").toLocalDate().toString())
                    .dials(dials)
                    .connected(connected)
                    .connectRate(percentage(connected, dials))
                    .talkSeconds(rs.getLong("talk_seconds"))
                    .build();
        });

        // Per-counsellor outcome counts (status → n), merged into the rows below.
        Map<String, Map<String, Long>> outcomesByUser = new HashMap<>();
        jdbc.query(CALL_OUTCOMES_SQL, params, rs -> {
            outcomesByUser
                    .computeIfAbsent(rs.getString("user_id"), k -> new LinkedHashMap<>())
                    .put(rs.getString("status"), rs.getLong("n"));
        });

        List<CallsDailyResponseDTO.CounsellorRow> byCounsellor =
                jdbc.query(CALLS_BY_COUNSELLOR_SQL, params, (rs, i) -> {
                    String userId = rs.getString("user_id");
                    long dials = rs.getLong("dials");
                    long connected = rs.getLong("connected");
                    long talkSeconds = rs.getLong("talk_seconds");
                    return CallsDailyResponseDTO.CounsellorRow.builder()
                            .userId(userId)
                            .dials(dials)
                            .connected(connected)
                            .connectRate(percentage(connected, dials))
                            .talkSeconds(talkSeconds)
                            .avgCallSeconds(connected > 0
                                    ? Math.round(talkSeconds * 10.0 / connected) / 10.0 : null)
                            .outcomes(outcomesByUser.getOrDefault(userId, Map.of()))
                            .build();
                });

        Map<String, String> names = fetchNames(
                byCounsellor.stream().map(CallsDailyResponseDTO.CounsellorRow::getUserId).toList());
        byCounsellor.forEach(r -> r.setName(names.get(r.getUserId())));

        return CallsDailyResponseDTO.builder().days(days).byCounsellor(byCounsellor).build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // calls-heatmap
    // ─────────────────────────────────────────────────────────────────────

    public CallsHeatmapResponseDTO callsHeatmap(String instituteId, String fromDate, String toDate,
                                                String teamId, String counsellorUserId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = leadReportSettingService.get(instituteId);
        ZoneId tz = safeZone(settings);
        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        MapSqlParameterSource params = callParams(instituteId, fromDate, toDate, tz, settings, scopeCsv);

        List<CallsHeatmapResponseDTO.Cell> cells = jdbc.query(CALLS_HEATMAP_SQL, params,
                (rs, i) -> CallsHeatmapResponseDTO.Cell.builder()
                        .dow(rs.getInt("dow"))
                        .hour(rs.getInt("hour"))
                        .dials(rs.getLong("dials"))
                        .connected(rs.getLong("connected"))
                        .build());

        return CallsHeatmapResponseDTO.builder().cells(cells).build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // calls-by-lead
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Per-lead call-attempt roll-up (view=CALLED, most-tried first) or the
     * in-window new leads never dialled (view=UNCALLED, newest first), plus a
     * summary spanning both populations. Paginated; search matches lead
     * name/mobile substring.
     */
    public CallsByLeadResponseDTO callsByLead(String instituteId, String fromDate, String toDate,
                                              String teamId, String counsellorUserId, String audienceId,
                                              String search, String view, int page, int size,
                                              String callerUserId) {
        LeadReportSettingService.ReportSettings settings = leadReportSettingService.get(instituteId);
        ZoneId tz = safeZone(settings);
        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));

        int safeSize = Math.max(1, Math.min(size, 100));
        int safePage = Math.max(0, page);
        boolean uncalledView = "UNCALLED".equalsIgnoreCase(trimToNull(view) == null ? "" : view.trim());
        // Explicit counsellor/team pick narrows to exactly those books; a scope
        // that only comes from caller RBAC keeps the unassigned pool visible
        // (leads-list rule — unassigned leads are everyone's to pick up).
        boolean includeUnassigned = trimToNull(counsellorUserId) == null && trimToNull(teamId) == null;

        MapSqlParameterSource params = callParams(instituteId, fromDate, toDate, tz, settings, scopeCsv)
                .addValue("audienceId", trimToNull(audienceId), Types.VARCHAR)
                .addValue("search", trimToNull(search), Types.VARCHAR)
                .addValue("includeUnassigned", includeUnassigned)
                .addValue("limit", safeSize)
                .addValue("offset", safePage * safeSize);

        CallsByLeadResponseDTO.Summary summary = jdbc.query(CALLS_BY_LEAD_SUMMARY_SQL, params, rs -> {
            if (!rs.next()) return CallsByLeadResponseDTO.Summary.builder().build();
            long leadsCalled = rs.getLong("leads_called");
            long leadsConnected = rs.getLong("leads_connected");
            return CallsByLeadResponseDTO.Summary.builder()
                    .leadsCalled(leadsCalled)
                    .totalDials(rs.getLong("total_dials"))
                    .leadsConnected(leadsConnected)
                    .leadsCallback(rs.getLong("leads_callback"))
                    .leadsNeverConnected(Math.max(0, leadsCalled - leadsConnected))
                    .build();
        });
        Long uncalledCount = jdbc.queryForObject(UNCALLED_LEADS_COUNT_SQL, params, Long.class);
        summary.setUncalledNewLeads(uncalledCount == null ? 0 : uncalledCount);

        CallsByLeadResponseDTO.CallsByLeadResponseDTOBuilder out = CallsByLeadResponseDTO.builder()
                .summary(summary)
                .page(safePage)
                .size(safeSize);

        if (uncalledView) {
            List<CallsByLeadResponseDTO.UncalledLeadRow> rows =
                    jdbc.query(UNCALLED_LEADS_ROWS_SQL, params, (rs, i) ->
                            CallsByLeadResponseDTO.UncalledLeadRow.builder()
                                    .responseId(rs.getString("response_id"))
                                    .userId(rs.getString("user_id"))
                                    .leadName(rs.getString("lead_name"))
                                    .leadPhone(rs.getString("lead_phone"))
                                    .sourceType(rs.getString("source_type"))
                                    .submittedAt(rs.getString("submitted_at"))
                                    .leadStatusLabel(rs.getString("lead_status_label"))
                                    .leadStatusColor(rs.getString("lead_status_color"))
                                    .counsellorUserId(rs.getString("counsellor_user_id"))
                                    .build());
            // One auth batch resolves counsellor names AND the lead identity for
            // user-linked leads (their name/mobile live on the auth user, not on
            // audience_response — parent_name is null for them).
            Map<String, UserDTO> users = fetchUsers(rows.stream()
                    .flatMap(r -> java.util.stream.Stream.of(
                            r.getCounsellorUserId(),
                            isBlank(r.getLeadName()) || isBlank(r.getLeadPhone()) ? r.getUserId() : null))
                    .toList());
            rows.forEach(r -> {
                UserDTO c = users.get(r.getCounsellorUserId());
                if (c != null) r.setCounsellorName(c.getFullName());
                UserDTO u = users.get(r.getUserId());
                if (u != null) {
                    if (isBlank(r.getLeadName())) r.setLeadName(u.getFullName());
                    if (isBlank(r.getLeadPhone())) r.setLeadPhone(u.getMobileNumber());
                }
            });
            out.uncalledRows(rows).totalRows(summary.getUncalledNewLeads());
        } else {
            List<CallsByLeadResponseDTO.CalledLeadRow> rows =
                    jdbc.query(CALLS_BY_LEAD_ROWS_SQL, params, (rs, i) ->
                            CallsByLeadResponseDTO.CalledLeadRow.builder()
                                    .responseId(rs.getString("response_id"))
                                    .userId(rs.getString("user_id"))
                                    .leadName(rs.getString("lead_name"))
                                    .leadPhone(rs.getString("lead_phone"))
                                    .leadStatusLabel(rs.getString("lead_status_label"))
                                    .leadStatusColor(rs.getString("lead_status_color"))
                                    .counsellorUserId(rs.getString("counsellor_user_id"))
                                    .attempts(rs.getLong("attempts"))
                                    .connected(rs.getLong("connected"))
                                    .callbacks(rs.getLong("callbacks"))
                                    .notPicked(rs.getLong("not_picked"))
                                    .failed(rs.getLong("failed"))
                                    .lastCallAt(rs.getString("last_call_at"))
                                    .lastCallStatus(rs.getString("last_call_status"))
                                    .lastDispositionKey(rs.getString("last_disposition_key"))
                                    .nextCallbackAt(rs.getString("next_callback_at"))
                                    .build());
            // Same dual-purpose auth batch as the UNCALLED view (see above).
            Map<String, UserDTO> users = fetchUsers(rows.stream()
                    .flatMap(r -> java.util.stream.Stream.of(
                            r.getCounsellorUserId(),
                            isBlank(r.getLeadName()) || isBlank(r.getLeadPhone()) ? r.getUserId() : null))
                    .toList());
            rows.forEach(r -> {
                UserDTO c = users.get(r.getCounsellorUserId());
                if (c != null) r.setCounsellorName(c.getFullName());
                UserDTO u = users.get(r.getUserId());
                if (u != null) {
                    if (isBlank(r.getLeadName())) r.setLeadName(u.getFullName());
                    if (isBlank(r.getLeadPhone())) r.setLeadPhone(u.getMobileNumber());
                }
            });
            Long total = jdbc.queryForObject(CALLS_BY_LEAD_COUNT_SQL, params, Long.class);
            out.rows(rows).totalRows(total == null ? 0 : total);
        }
        return out.build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // followup-aging
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Point-in-time — fromDate/toDate are accepted by the controller for
     * signature consistency across report endpoints but intentionally ignored.
     */
    public FollowupAgingResponseDTO followupAging(String instituteId,
                                                  String teamId, String counsellorUserId,
                                                  String audienceId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = leadReportSettingService.get(instituteId);
        ZoneId tz = safeZone(settings);
        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));

        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("tz", tz.getId())
                .addValue("scopeCsv", scopeCsv, Types.VARCHAR)
                .addValue("audienceId", trimToNull(audienceId), Types.VARCHAR);

        long[] totals = new long[5]; // due_today, 1_3, 3_7, 7_plus, upcoming
        List<FollowupAgingResponseDTO.CounsellorRow> byCounsellor = new ArrayList<>();
        jdbc.query(FOLLOWUP_AGING_SQL, params, rs -> {
            long dueToday = rs.getLong("due_today");
            long o13 = rs.getLong("overdue_1_3");
            long o37 = rs.getLong("overdue_3_7");
            long o7p = rs.getLong("overdue_7_plus");
            long upcoming = rs.getLong("upcoming");
            totals[0] += dueToday;
            totals[1] += o13;
            totals[2] += o37;
            totals[3] += o7p;
            totals[4] += upcoming;
            String userId = rs.getString("user_id");
            if (userId == null) return; // bucket totals keep ownerless rows; the table skips them
            byCounsellor.add(FollowupAgingResponseDTO.CounsellorRow.builder()
                    .userId(userId)
                    .dueToday(dueToday)
                    .overdue1To3(o13)
                    .overdue3To7(o37)
                    .overdue7Plus(o7p)
                    .upcoming(upcoming)
                    .oldestOverdueDays(getNullableLong(rs, "oldest_overdue_days"))
                    .build());
        });
        // Most-buried counsellors first: total overdue desc, then due-today desc.
        byCounsellor.sort((a, b) -> {
            long oa = a.getOverdue1To3() + a.getOverdue3To7() + a.getOverdue7Plus();
            long ob = b.getOverdue1To3() + b.getOverdue3To7() + b.getOverdue7Plus();
            if (oa != ob) return Long.compare(ob, oa);
            return Long.compare(b.getDueToday(), a.getDueToday());
        });

        Map<String, String> names = fetchNames(
                byCounsellor.stream().map(FollowupAgingResponseDTO.CounsellorRow::getUserId).toList());
        byCounsellor.forEach(r -> r.setName(names.get(r.getUserId())));

        List<FollowupAgingResponseDTO.Bucket> buckets = List.of(
                new FollowupAgingResponseDTO.Bucket("DUE_TODAY", totals[0]),
                new FollowupAgingResponseDTO.Bucket("OVERDUE_1_3", totals[1]),
                new FollowupAgingResponseDTO.Bucket("OVERDUE_3_7", totals[2]),
                new FollowupAgingResponseDTO.Bucket("OVERDUE_7_PLUS", totals[3]),
                new FollowupAgingResponseDTO.Bucket("UPCOMING", totals[4]));

        MapSqlParameterSource closureParams = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("scopeCsv", scopeCsv, Types.VARCHAR)
                .addValue("audienceId", trimToNull(audienceId), Types.VARCHAR)
                .addValue("closedSince",
                        LocalDateTime.now(ZoneOffset.UTC).minusDays(CLOSURE_REASON_WINDOW_DAYS),
                        Types.TIMESTAMP);
        List<FollowupAgingResponseDTO.ClosureReason> closureReasons =
                jdbc.query(CLOSURE_REASONS_SQL, closureParams,
                        (rs, i) -> new FollowupAgingResponseDTO.ClosureReason(
                                rs.getString("reason"), rs.getLong("n")));

        return FollowupAgingResponseDTO.builder()
                .buckets(buckets)
                .byCounsellor(byCounsellor)
                .closureReasons(closureReasons)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /** Common bind set for the three call queries. */
    private MapSqlParameterSource callParams(String instituteId, String fromDate, String toDate,
                                             ZoneId tz, LeadReportSettingService.ReportSettings settings,
                                             String scopeCsv) {
        Window w = resolveWindow(fromDate, toDate, tz);
        return new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("tz", tz.getId())
                .addValue("connectedCsv", connectedCsv(settings))
                .addValue("scopeCsv", scopeCsv, Types.VARCHAR)
                .addValue("fromUtc", w.fromUtc(), Types.TIMESTAMP)
                .addValue("toUtc", w.toUtc(), Types.TIMESTAMP);
    }

    /**
     * fromDate/toDate are institute-TZ calendar dates (yyyy-MM-dd, both
     * inclusive). Convert to UTC instants for the half-open range predicate:
     * from 00:00 → (to + 1 day) 00:00 in the institute zone. Defaults to the
     * trailing 30 days ending today (institute TZ), matching LeadReportService.
     * Columns store UTC wall-clock, so we bind UTC LocalDateTimes — immune to
     * the JVM default zone (no java.sql.Timestamp involved).
     */
    private Window resolveWindow(String fromDate, String toDate, ZoneId tz) {
        LocalDate today = LocalDate.now(tz);
        LocalDate to = parseOr(toDate, today);
        LocalDate from = parseOr(fromDate, to.minusDays(DEFAULT_RANGE_DAYS - 1L));
        return new Window(
                from.atStartOfDay(tz).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime(),
                to.plusDays(1).atStartOfDay(tz).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
    }

    private record Window(LocalDateTime fromUtc, LocalDateTime toUtc) {
    }

    /** Bad/missing timezone config must degrade, not 500 the report. */
    private ZoneId safeZone(LeadReportSettingService.ReportSettings settings) {
        try {
            return ZoneId.of(settings.timezone());
        } catch (Exception e) {
            log.warn("[CallingReport] invalid report timezone '{}', falling back to {}",
                    settings != null ? settings.timezone() : null, FALLBACK_ZONE);
            return FALLBACK_ZONE;
        }
    }

    /** Connected-status set as the CSV the SQL FILTERs bind; defensive default COMPLETED. */
    private static String connectedCsv(LeadReportSettingService.ReportSettings settings) {
        Set<String> statuses = settings != null ? settings.connectedCallStatuses() : null;
        if (statuses == null || statuses.isEmpty()) return "COMPLETED";
        return String.join(",", statuses);
    }

    /**
     * Batch user hydration via auth-service (cross-DB — never JOIN users in
     * admin_core SQL). One HTTP call; failure leaves the map empty (names/
     * phones stay null) instead of failing the report.
     */
    private Map<String, UserDTO> fetchUsers(Collection<String> userIds) {
        List<String> ids = userIds.stream().filter(id -> id != null && !id.isBlank()).distinct().toList();
        if (ids.isEmpty()) return Map.of();
        Map<String, UserDTO> out = new HashMap<>();
        try {
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(ids))) {
                if (u != null && u.getId() != null) out.put(u.getId(), u);
            }
        } catch (Exception e) {
            log.warn("[CallingReport] auth user hydration failed: {}", e.getMessage());
        }
        return out;
    }

    /** Display-name view over {@link #fetchUsers}. */
    private Map<String, String> fetchNames(Collection<String> userIds) {
        Map<String, String> out = new HashMap<>();
        fetchUsers(userIds).forEach((id, u) -> out.put(id, u.getFullName()));
        return out;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static LocalDate parseOr(String iso, LocalDate fallback) {
        if (iso == null || iso.isBlank()) return fallback;
        try {
            return LocalDate.parse(iso.trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String trimToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    /** num/denom as a 0–100 percentage, 1 decimal; null when denom == 0. */
    private static Double percentage(long num, long denom) {
        if (denom == 0) return null;
        return Math.round(num * 1000.0 / denom) / 10.0;
    }

    private static Long getNullableLong(ResultSet rs, String col) throws SQLException {
        long v = rs.getLong(col);
        return rs.wasNull() ? null : v;
    }
}
