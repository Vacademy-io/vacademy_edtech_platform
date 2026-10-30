package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import vacademy.io.admin_core_service.features.audience.dto.reports.DispositionReportDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.FunnelVelocityReportDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.SourcePerformanceReportDTO;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * lead_status_history-centric report aggregates for the Reports Center tabs:
 * source-performance (Sources tab), dispositions and funnel-velocity (Funnel tab).
 *
 * Read-only JdbcTemplate raw SQL, same shape as SalesDashboardService. Conventions shared with
 * the rest of the report suite:
 *   - NEVER joins the users table (separate DB) — names are hydrated via one AuthService batch.
 *   - Per-lead counsellor identity = COALESCE(linked_users-lateral user_id, ulp.assigned_counselor_id)
 *     (same lateral as AudienceResponseRepository.findReport*). Dispositions scope on the actor /
 *     counsellor id columns directly instead — those reports are about WHO acted, not whose lead.
 *   - RBAC scope arrives as a CSV from {@link ReportScopeResolver}: null = no filter (admin setup
 *     mode), "" = matches nothing (zeroed report — STRING_TO_ARRAY('', ',') is the empty array).
 *   - OPTED_OUT leads excluded everywhere (ar.overall_status IS NULL OR != 'OPTED_OUT').
 *   - Timestamps are stored UTC in 'timestamp without time zone' columns. fromDate/toDate are
 *     DATES in the institute timezone ({@link LeadReportSettingService}); we convert them to UTC
 *     wall-clock bounds in Java (from = 00:00 of fromDate in tz; to = 00:00 of toDate+1, exclusive),
 *     so the SQL needs no AT TIME ZONE gymnastics — these reports have no day/hour bucketing.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PipelineReportService {

    private final NamedParameterJdbcTemplate jdbc;
    private final ReportScopeResolver scopeResolver;
    private final LeadReportSettingService settingService;
    private final AuthService authService;
    private final vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService counsellorScopeService;

    private static final int DEFAULT_RANGE_DAYS = 30;
    private static final String SYSTEM_ACTOR_ID = "SYSTEM";
    private static final String SYSTEM_ACTOR_NAME = "System/Workflow";
    private static final String UNASSIGNED_ACTOR_ID = "UNASSIGNED";
    private static final String UNASSIGNED_ACTOR_NAME = "Unassigned";

    // ─────────────────────────────────────────────────────────────────────
    // Shared SQL fragments
    // ─────────────────────────────────────────────────────────────────────

    /**
     * The canonical lead-scope predicate block (used inside a WHERE on audience_response ar
     * joined to audience a, the linked_users lateral lu and user_lead_profile ulp).
     */
    private static final String LEAD_SCOPE_JOINS = """
            FROM audience_response ar
            JOIN audience a ON a.id = ar.audience_id
            LEFT JOIN LATERAL (
                SELECT lu.user_id FROM linked_users lu
                WHERE lu.source = 'ENQUIRY' AND lu.source_id = ar.enquiry_id
                ORDER BY lu.created_at DESC LIMIT 1
            ) lu ON true
            LEFT JOIN user_lead_profile ulp
                ON ulp.user_id = ar.user_id AND ulp.institute_id = a.institute_id
            """;

    private static final String LEAD_SCOPE_PREDICATES = """
              AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
              AND (:scopeCsv IS NULL OR COALESCE(lu.user_id, ulp.assigned_counselor_id) = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
              AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
            """;

    // ─────────────────────────────────────────────────────────────────────
    // Source performance
    // ─────────────────────────────────────────────────────────────────────

    private static final String SOURCE_PERFORMANCE_SQL = """
            WITH base AS (
                SELECT ar.id,
                       ar.user_id,
                       """ + ReportSourceSql.effective("ar.source_type", "a.campaign_type") + """
                           AS source_type,
                       """ + ReportSourceSql.fromCampaignType("ar.source_type", "a.campaign_type") + """
                           AS from_campaign_type,
                       ulp.conversion_status,
                       ulp.converted_at,
                       -- ≥1 call with a "connected" status (institute-configurable set).
                       -- Calls are matched by response_id when the call row carries one,
                       -- falling back to user_id otherwise. Intentionally NOT date-bounded:
                       -- "did we ever connect with this in-window cohort".
                       EXISTS (
                           SELECT 1 FROM telephony_call_log tcl
                           WHERE tcl.institute_id = :instituteId
                             AND (tcl.response_id = ar.id
                                  OR (tcl.response_id IS NULL AND ar.user_id IS NOT NULL AND tcl.user_id = ar.user_id))
                             AND tcl.status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))
                       ) AS connected,
                       -- ≥1 in-window transition into an institute-configured "interested" status.
                       EXISTS (
                           SELECT 1 FROM lead_status_history lsh
                           JOIN lead_status ls ON ls.id = lsh.to_status_id
                           WHERE lsh.audience_response_id = ar.id
                             AND lsh.changed_at >= :fromTs AND lsh.changed_at < :toTs
                             AND ls.status_key = ANY(STRING_TO_ARRAY(:interestedCsv, ','))
                       ) AS interested
                """ + LEAD_SCOPE_JOINS + """
                WHERE a.institute_id = :instituteId
                  AND ar.submitted_at >= :fromTs
                  AND ar.submitted_at <  :toTs
                """ + LEAD_SCOPE_PREDICATES + """
            )
            SELECT b.source_type,
                   BOOL_OR(b.from_campaign_type)         AS from_campaign_type,
                   COUNT(*)                              AS leads,
                   COUNT(*) FILTER (WHERE b.connected)   AS connected_leads,
                   COUNT(*) FILTER (WHERE b.interested)  AS interested,
                   COUNT(*) FILTER (WHERE b.conversion_status = 'CONVERTED'
                                      AND b.converted_at >= :fromTs
                                      AND b.converted_at <  :toTs) AS won
            FROM base b
            GROUP BY b.source_type
            ORDER BY leads DESC, b.source_type
            """;

    /**
     * PAID revenue per source from CONVERTED leads whose payment landed in-window. Same recognition
     * rule as RevenueReportService (payment_status='PAID', conversion_status='CONVERTED', payment
     * created_at in window); attributed by the lead profile's best_source_type so it lines up with
     * the source rows above. payment_log carries no institute_id — the user_lead_profile join scopes
     * it to this institute's converted leads.
     */
    private static final String SOURCE_REVENUE_SQL = """
            SELECT """ + ReportSourceSql.effective("COALESCE(ulp.best_source_type, ar.source_type)", "sa.campaign_type") + """
                       AS source_type,
                   COALESCE(SUM(pl.payment_amount), 0)                        AS revenue
            FROM payment_log pl
            JOIN user_lead_profile ulp
                ON ulp.user_id = pl.user_id AND ulp.institute_id = :instituteId
            LEFT JOIN audience_response ar ON ar.id = ulp.best_score_response_id
            LEFT JOIN audience sa ON sa.id = ar.audience_id
            LEFT JOIN LATERAL (
                SELECT lu2.user_id FROM linked_users lu2
                WHERE lu2.source = 'ENQUIRY' AND lu2.source_id = ar.enquiry_id
                ORDER BY lu2.created_at DESC LIMIT 1
            ) lu ON true
            WHERE pl.payment_status = 'PAID'
              AND pl.payment_amount IS NOT NULL
              AND ulp.conversion_status = 'CONVERTED'
              AND pl.created_at >= :fromTs AND pl.created_at < :toTs
              AND (:scopeCsv IS NULL OR COALESCE(lu.user_id, ulp.assigned_counselor_id) = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
              AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
            GROUP BY 1
            """;

    @Transactional(readOnly = true)
    public SourcePerformanceReportDTO getSourcePerformance(String instituteId, String fromDate, String toDate,
                                                           String teamId, String counsellorUserId,
                                                           String audienceId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        Window w = resolveWindow(fromDate, toDate, settings.timezone());
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));

        MapSqlParameterSource p = baseParams(instituteId, w, scopeCsv, audienceId)
                .addValue("connectedCsv", joinSet(settings.connectedCallStatuses()))
                .addValue("interestedCsv", joinSet(settings.interestedStatusKeys()));

        // Revenue per source (keyed by best_source_type), merged onto the rows below.
        Map<String, Double> revenueBySource = new HashMap<>();
        jdbc.query(SOURCE_REVENUE_SQL, p, (RowCallbackHandler) rs ->
                revenueBySource.put(rs.getString("source_type"), rs.getDouble("revenue")));

        List<SourcePerformanceReportDTO.Row> rows = jdbc.query(SOURCE_PERFORMANCE_SQL, p, (rs, i) -> {
            long leads = rs.getLong("leads");
            long won = rs.getLong("won");
            String sourceType = rs.getString("source_type");
            return SourcePerformanceReportDTO.Row.builder()
                    .sourceType(sourceType)
                    .campaignType(rs.getBoolean("from_campaign_type") ? sourceType : null)
                    .leads(leads)
                    .connectedLeads(rs.getLong("connected_leads"))
                    .interested(rs.getLong("interested"))
                    .won(won)
                    .conversionRate(percentage(won, leads))
                    .revenue(round2(revenueBySource.getOrDefault(sourceType, 0.0)))
                    .build(); // spend / cpl / roi stay null — Wave 2/3
        });

        long tLeads = rows.stream().mapToLong(SourcePerformanceReportDTO.Row::getLeads).sum();
        long tWon = rows.stream().mapToLong(SourcePerformanceReportDTO.Row::getWon).sum();
        SourcePerformanceReportDTO.Row totals = SourcePerformanceReportDTO.Row.builder()
                .leads(tLeads)
                .connectedLeads(rows.stream().mapToLong(SourcePerformanceReportDTO.Row::getConnectedLeads).sum())
                .interested(rows.stream().mapToLong(SourcePerformanceReportDTO.Row::getInterested).sum())
                .won(tWon)
                .conversionRate(percentage(tWon, tLeads))
                .revenue(round2(rows.stream().mapToDouble(SourcePerformanceReportDTO.Row::getRevenue).sum()))
                .build();

        return SourcePerformanceReportDTO.builder().rows(rows).totals(totals).build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Dispositions
    // ─────────────────────────────────────────────────────────────────────

    private static final String ACTIVE_STATUSES_SQL = """
            SELECT status_key, label, color
            FROM lead_status
            WHERE institute_id = :instituteId AND is_active = true
            ORDER BY display_order, status_key
            """;

    /**
     * Status changes per actor × to-status. Scope is applied to the ACTOR id itself (who made
     * the change), per the dispositions contract — NULL actors (workflow/auto) collapse into a
     * synthetic SYSTEM row, which therefore only shows up for unscoped (admin) callers: NULL is
     * never inside a scope CSV.
     */
    private static final String STATUS_CHANGES_SQL = """
            SELECT COALESCE(lsh.changed_by_user_id, 'SYSTEM') AS actor_id,
                   ls.status_key,
                   COUNT(*) AS n
            FROM lead_status_history lsh
            JOIN lead_status ls ON ls.id = lsh.to_status_id AND ls.is_active = true
            JOIN audience_response ar ON ar.id = lsh.audience_response_id
            WHERE lsh.institute_id = :instituteId
              AND lsh.changed_at >= :fromTs
              AND lsh.changed_at <  :toTs
              AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
              AND (:scopeCsv IS NULL OR lsh.changed_by_user_id = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
              AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
            GROUP BY 1, 2
            """;

    /**
     * Leads assigned to each counsellor that have never had a status change recorded — i.e.
     * zero rows in lead_status_history across any of their audience_responses in this institute.
     * Scoped to the report window via ar2.submitted_at, matching Recent Leads and the other
     * disposition metrics — a lead only counts as "pending" here if it was submitted in-window,
     * on a NON-deleted, non-opted-out response (same ACTIVE + OPTED_OUT guards as the leads
     * list and the current-status matrix — without them a deleted lead kept counting as
     * "pending" while every other surface hid it, and the columns didn't reconcile).
     * audienceId filter is honoured so the count scopes to a single campaign when selected.
     */
    private static final String PENDING_LEADS_SQL = """
            SELECT ulp.assigned_counselor_id AS actor_id,
                   COUNT(DISTINCT ulp.user_id) AS pending_count
            FROM user_lead_profile ulp
            WHERE ulp.institute_id = :instituteId
              AND ulp.assigned_counselor_id IS NOT NULL
              AND (:scopeCsv IS NULL OR ulp.assigned_counselor_id = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
              AND EXISTS (
                  SELECT 1 FROM audience_response ar2
                  WHERE (ar2.user_id = ulp.user_id OR ar2.student_user_id = ulp.user_id)
                    AND ar2.submitted_at >= :fromTs AND ar2.submitted_at < :toTs
                    AND ar2.audience_status = 'ACTIVE'
                    AND (ar2.overall_status IS NULL OR ar2.overall_status != 'OPTED_OUT')
                    AND (:audienceId IS NULL OR ar2.audience_id = :audienceId)
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM audience_response ar
                  JOIN lead_status_history lsh ON lsh.audience_response_id = ar.id
                  WHERE (ar.user_id = ulp.user_id OR ar.student_user_id = ulp.user_id)
                    AND lsh.institute_id = :instituteId
                    AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
              )
            GROUP BY ulp.assigned_counselor_id
            """;

    /**
     * Call outcomes per counsellor × call status. created_at (NOT NULL) is the window column —
     * start_time is null for calls that never left the provider queue and those outcomes
     * (FAILED / NO_ANSWER / …) are exactly what this report is for.
     */
    private static final String CALL_OUTCOMES_SQL = """
            SELECT tcl.counsellor_user_id AS actor_id,
                   tcl.status,
                   COUNT(*) AS n
            FROM telephony_call_log tcl
            WHERE tcl.institute_id = :instituteId
              AND tcl.created_at >= :fromTs
              AND tcl.created_at <  :toTs
              AND (:scopeCsv IS NULL OR tcl.counsellor_user_id = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
            GROUP BY 1, 2
            """;

    /**
     * "Where do each counsellor's recent leads stand" matrix: the leads SUBMITTED in the report
     * window, bucketed by counsellor × CURRENT status — i.e. "of the last 30 days' leads, 10 are
     * New, 5 Converted". The window bounds the COHORT (ar.submitted_at, same as source-performance
     * and Recent Leads); the status read is always the lead's status as of now. Status resolution
     * mirrors the leads list: the response's lead_status_id first, falling back to the profile's
     * conversion_status (which the bidirectional mirror keeps holding a status_key); both NULL →
     * the NO-STATUS bucket (NULL status_key row here). Counsellor identity = the per-lead
     * COALESCE(lu.user_id, assigned_counselor_id) convention; NULL collapses into a synthetic
     * UNASSIGNED row, which — like SYSTEM — only appears for unscoped callers (NULL never matches
     * a scope CSV). DISTINCT on the lead's user id so a multi-response lead counts once per
     * status, not once per response. Soft-deleted leads are excluded (audience_status = 'ACTIVE')
     * to match the Recent Leads list default (EXCLUDE_DELETED) — without this the matrix counts
     * deleted leads the list can't show, and the two screens disagree.
     */
    private static final String CURRENT_STATUS_BY_COUNSELLOR_SQL = """
            SELECT COALESCE(lu.user_id, ulp.assigned_counselor_id, 'UNASSIGNED') AS actor_id,
                   COALESCE(lst.status_key, ulp.conversion_status)               AS status_key,
                   COUNT(DISTINCT COALESCE(ar.user_id, ar.student_user_id, ar.id)) AS n
            """ + LEAD_SCOPE_JOINS + """
            LEFT JOIN lead_status lst ON lst.id = ar.lead_status_id
            WHERE a.institute_id = :instituteId
              AND ar.submitted_at >= :fromTs
              AND ar.submitted_at <  :toTs
              AND ar.audience_status = 'ACTIVE'
            """ + LEAD_SCOPE_PREDICATES + """
            GROUP BY 1, 2
            """;

    @Transactional(readOnly = true)
    public DispositionReportDTO getDispositions(String instituteId, String fromDate, String toDate,
                                                String teamId, String counsellorUserId,
                                                String audienceId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        Window w = resolveWindow(fromDate, toDate, settings.timezone());
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        // NOTE: audienceId filters the status-change matrix (STATUS_CHANGES_SQL joins
        // audience_response). The call-outcomes matrix is built from telephony_call_log,
        // which has no reliable campaign link, so it stays campaign-unfiltered by design.
        MapSqlParameterSource p = baseParams(instituteId, w, scopeCsv, audienceId);

        List<DispositionReportDTO.StatusMeta> statuses = jdbc.query(ACTIVE_STATUSES_SQL,
                new MapSqlParameterSource("instituteId", instituteId),
                (rs, i) -> DispositionReportDTO.StatusMeta.builder()
                        .statusKey(rs.getString("status_key"))
                        .label(rs.getString("label"))
                        .color(rs.getString("color"))
                        .build());

        // actor → (status_key → count). Typed RowCallbackHandler locals keep the
        // query(...) overload resolution unambiguous (vs ResultSetExtractor).
        Map<String, Map<String, Long>> changesByActor = new LinkedHashMap<>();
        RowCallbackHandler changesCollector = rs -> changesByActor
                .computeIfAbsent(rs.getString("actor_id"), k -> new LinkedHashMap<>())
                .merge(rs.getString("status_key"), rs.getLong("n"), Long::sum);
        jdbc.query(STATUS_CHANGES_SQL, p, changesCollector);

        // counsellor → pending count (assigned leads with no history at all)
        Map<String, Long> pendingByActor = new LinkedHashMap<>();
        RowCallbackHandler pendingCollector = rs ->
                pendingByActor.put(rs.getString("actor_id"), rs.getLong("pending_count"));
        jdbc.query(PENDING_LEADS_SQL, p, pendingCollector);

        // counsellor → (CALL_STATUS → count)
        Map<String, Map<String, Long>> outcomesByActor = new LinkedHashMap<>();
        RowCallbackHandler outcomesCollector = rs -> {
            String actor = rs.getString("actor_id");
            if (actor == null) return;
            outcomesByActor
                    .computeIfAbsent(actor, k -> new LinkedHashMap<>())
                    .merge(rs.getString("status"), rs.getLong("n"), Long::sum);
        };
        jdbc.query(CALL_OUTCOMES_SQL, p, outcomesCollector);

        // counsellor → (status_key → leads currently in that status), plus the
        // no-status bucket (NULL status_key rows) kept alongside.
        Map<String, Map<String, Long>> currentByCounsellor = new LinkedHashMap<>();
        Map<String, Long> noStatusByCounsellor = new LinkedHashMap<>();
        RowCallbackHandler currentStatusCollector = rs -> {
            String actor = rs.getString("actor_id");
            String statusKey = rs.getString("status_key");
            long n = rs.getLong("n");
            Map<String, Long> byStatus = currentByCounsellor.computeIfAbsent(actor, k -> new LinkedHashMap<>());
            if (statusKey == null) {
                noStatusByCounsellor.merge(actor, n, Long::sum);
            } else {
                byStatus.merge(statusKey, n, Long::sum);
            }
        };
        jdbc.query(CURRENT_STATUS_BY_COUNSELLOR_SQL, p, currentStatusCollector);

        // Every ACTIVE counsellor in scope gets a row in ALL matrices — the
        // SQL groups the DATA, so a counsellor with no status changes / calls
        // in the window used to vanish from the report entirely. Zero-filled
        // rows sort to the bottom via the existing total-desc ordering.
        for (String id : scopedActiveCounsellors(instituteId, scopeCsv)) {
            changesByActor.computeIfAbsent(id, k -> new LinkedHashMap<>());
            outcomesByActor.computeIfAbsent(id, k -> new LinkedHashMap<>());
            currentByCounsellor.computeIfAbsent(id, k -> new LinkedHashMap<>());
        }

        // One auth-service batch for the union of human actor ids across all groupings.
        Set<String> ids = new LinkedHashSet<>();
        ids.addAll(changesByActor.keySet());
        ids.addAll(outcomesByActor.keySet());
        ids.addAll(currentByCounsellor.keySet());
        ids.remove(SYSTEM_ACTOR_ID);
        ids.remove(UNASSIGNED_ACTOR_ID);
        Map<String, String> nameById = resolveNames(ids);

        List<DispositionReportDTO.ActorChangesRow> rows = changesByActor.entrySet().stream()
                .map(e -> DispositionReportDTO.ActorChangesRow.builder()
                        .userId(e.getKey())
                        .name(displayName(e.getKey(), nameById))
                        .totalChanges(e.getValue().values().stream().mapToLong(Long::longValue).sum())
                        .changes(e.getValue())
                        .pendingCount(pendingByActor.getOrDefault(e.getKey(), 0L))
                        .build())
                .sorted((a, b) -> Long.compare(b.getTotalChanges(), a.getTotalChanges()))
                .collect(Collectors.toList());

        List<DispositionReportDTO.CallOutcomeRow> callOutcomes = outcomesByActor.entrySet().stream()
                .map(e -> DispositionReportDTO.CallOutcomeRow.builder()
                        .userId(e.getKey())
                        .name(displayName(e.getKey(), nameById))
                        .outcomes(e.getValue())
                        .build())
                .sorted((a, b) -> Long.compare(
                        b.getOutcomes().values().stream().mapToLong(Long::longValue).sum(),
                        a.getOutcomes().values().stream().mapToLong(Long::longValue).sum()))
                .collect(Collectors.toList());

        List<DispositionReportDTO.CurrentStatusRow> currentStatusRows = currentByCounsellor.entrySet().stream()
                .map(e -> {
                    long noStatus = noStatusByCounsellor.getOrDefault(e.getKey(), 0L);
                    long total = e.getValue().values().stream().mapToLong(Long::longValue).sum() + noStatus;
                    return DispositionReportDTO.CurrentStatusRow.builder()
                            .userId(e.getKey())
                            .name(displayName(e.getKey(), nameById))
                            .totalLeads(total)
                            .statuses(e.getValue())
                            .noStatusCount(noStatus)
                            .build();
                })
                .sorted((a, b) -> Long.compare(b.getTotalLeads(), a.getTotalLeads()))
                .collect(Collectors.toList());

        return DispositionReportDTO.builder()
                .statuses(statuses)
                .rows(rows)
                .callOutcomes(callOutcomes)
                .currentStatusRows(currentStatusRows)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Funnel velocity
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Per-stage stats from stints. A stint = transition INTO a status (entered_at) until the
     * lead's NEXT transition (exited_at, via LEAD() over the lead's full ordered history — the
     * stints CTE is deliberately NOT date-bounded so open windows still see each stint's real
     * end; the in_window CTE then keeps stints that STARTED in range). The outer query is driven
     * by the active status catalog so every stage row exists even with zero activity.
     */
    private static final String FUNNEL_STAGES_SQL = """
            WITH scoped_leads AS (
                SELECT ar.id
                """ + LEAD_SCOPE_JOINS + """
                WHERE a.institute_id = :instituteId
                """ + LEAD_SCOPE_PREDICATES + """
            ),
            stints AS (
                SELECT lsh.to_status_id                  AS status_id,
                       lsh.changed_at                    AS entered_at,
                       LEAD(lsh.changed_at)   OVER w     AS exited_at,
                       LEAD(lsh.to_status_id) OVER w     AS next_status_id
                FROM lead_status_history lsh
                JOIN scoped_leads sl ON sl.id = lsh.audience_response_id
                WHERE lsh.institute_id = :instituteId
                WINDOW w AS (PARTITION BY lsh.audience_response_id ORDER BY lsh.changed_at, lsh.id)
            ),
            in_window AS (
                SELECT s.status_id, s.entered_at, s.exited_at,
                       nls.display_order AS next_order
                FROM stints s
                LEFT JOIN lead_status nls ON nls.id = s.next_status_id
                WHERE s.entered_at >= :fromTs AND s.entered_at < :toTs
            )
            SELECT ls.status_key, ls.label, ls.color, ls.display_order,
                   COUNT(iw.status_id) AS entered,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (iw.exited_at - iw.entered_at)) / 86400.0)
                       FILTER (WHERE iw.exited_at IS NOT NULL)                         AS median_days_in_stage,
                   COUNT(iw.status_id) FILTER (WHERE iw.next_order > ls.display_order) AS advanced,
                   COUNT(iw.status_id) FILTER (WHERE iw.next_order < ls.display_order) AS regressed
            FROM lead_status ls
            LEFT JOIN in_window iw ON iw.status_id = ls.id
            WHERE ls.institute_id = :instituteId AND ls.is_active = true
            GROUP BY ls.id, ls.status_key, ls.label, ls.color, ls.display_order
            ORDER BY ls.display_order, ls.status_key
            """;

    /** Point-in-time stock: leads currently holding each status (scoped, opt-outs excluded). */
    private static final String CURRENT_STOCK_SQL = """
            SELECT ls.status_key, COUNT(*) AS stock
            """ + LEAD_SCOPE_JOINS + """
            JOIN lead_status ls ON ls.id = ar.lead_status_id
            WHERE a.institute_id = :instituteId
            """ + LEAD_SCOPE_PREDICATES + """
            GROUP BY ls.status_key
            """;

    /**
     * Median days to convert for leads CONVERTED in-window: from the lead's first history row
     * (fallback: submitted_at) to its first in-window CONVERTED transition.
     */
    private static final String MEDIAN_DAYS_TO_CONVERT_SQL = """
            WITH scoped_leads AS (
                SELECT ar.id, ar.submitted_at
                """ + LEAD_SCOPE_JOINS + """
                WHERE a.institute_id = :instituteId
                """ + LEAD_SCOPE_PREDICATES + """
            ),
            conv AS (
                SELECT lsh.audience_response_id, MIN(lsh.changed_at) AS converted_at
                FROM lead_status_history lsh
                JOIN lead_status ls ON ls.id = lsh.to_status_id AND ls.status_key = 'CONVERTED'
                JOIN scoped_leads sl ON sl.id = lsh.audience_response_id
                WHERE lsh.institute_id = :instituteId
                  AND lsh.changed_at >= :fromTs AND lsh.changed_at < :toTs
                GROUP BY lsh.audience_response_id
            )
            SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
                       EXTRACT(EPOCH FROM (c.converted_at - COALESCE(fh.first_at, sl.submitted_at))) / 86400.0
                   ) AS median_days
            FROM conv c
            JOIN scoped_leads sl ON sl.id = c.audience_response_id
            LEFT JOIN LATERAL (
                SELECT MIN(h.changed_at) AS first_at
                FROM lead_status_history h
                WHERE h.audience_response_id = c.audience_response_id
            ) fh ON true
            """;

    /** Same cohort definitions as source-performance totals: submitted in-window vs won in-window. */
    private static final String OVERALL_CONVERSION_SQL = """
            SELECT COUNT(*) AS leads,
                   COUNT(*) FILTER (WHERE ulp.conversion_status = 'CONVERTED'
                                      AND ulp.converted_at >= :fromTs
                                      AND ulp.converted_at <  :toTs) AS won
            """ + LEAD_SCOPE_JOINS + """
            WHERE a.institute_id = :instituteId
              AND ar.submitted_at >= :fromTs
              AND ar.submitted_at <  :toTs
            """ + LEAD_SCOPE_PREDICATES;

    @Transactional(readOnly = true)
    public FunnelVelocityReportDTO getFunnelVelocity(String instituteId, String fromDate, String toDate,
                                                     String teamId, String counsellorUserId,
                                                     String audienceId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        Window w = resolveWindow(fromDate, toDate, settings.timezone());
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        MapSqlParameterSource p = baseParams(instituteId, w, scopeCsv, audienceId);

        Map<String, Long> stockByKey = new HashMap<>();
        RowCallbackHandler stockCollector = rs ->
                stockByKey.put(rs.getString("status_key"), rs.getLong("stock"));
        jdbc.query(CURRENT_STOCK_SQL, p, stockCollector);

        List<FunnelVelocityReportDTO.Stage> stages = jdbc.query(FUNNEL_STAGES_SQL, p, (rs, i) -> {
            String statusKey = rs.getString("status_key");
            long entered = rs.getLong("entered");
            long advanced = rs.getLong("advanced");
            return FunnelVelocityReportDTO.Stage.builder()
                    .statusKey(statusKey)
                    .label(rs.getString("label"))
                    .color(rs.getString("color"))
                    .displayOrder(rs.getInt("display_order"))
                    .entered(entered)
                    .currentStock(stockByKey.getOrDefault(statusKey, 0L))
                    .medianDaysInStage(round1(getNullableDouble(rs, "median_days_in_stage")))
                    .advanced(advanced)
                    .advancedRate(percentage(advanced, entered))
                    .regressed(rs.getLong("regressed"))
                    .build();
        });

        Double medianDaysToConvert = jdbc.queryForObject(MEDIAN_DAYS_TO_CONVERT_SQL, p, Double.class);
        long[] overallCounts = jdbc.queryForObject(OVERALL_CONVERSION_SQL, p,
                (rs, i) -> new long[]{rs.getLong("leads"), rs.getLong("won")});
        long leads = overallCounts != null ? overallCounts[0] : 0L;
        long won = overallCounts != null ? overallCounts[1] : 0L;

        return FunnelVelocityReportDTO.builder()
                .stages(stages)
                .overall(FunnelVelocityReportDTO.Overall.builder()
                        .medianDaysToConvert(round1(medianDaysToConvert))
                        .conversionRate(percentage(won, leads))
                        .build())
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /**
     * fromDate/toDate are dates in the INSTITUTE timezone; range predicates need UTC wall-clock
     * bounds (columns store UTC in timestamp-without-time-zone). Timestamp.valueOf(LocalDateTime)
     * round-trips the wall clock through JDBC regardless of JVM TZ, so the bind is exact.
     * Defaults to the last {@value #DEFAULT_RANGE_DAYS} days ending today (institute TZ).
     */
    private Window resolveWindow(String fromDate, String toDate, String tz) {
        ZoneId zone;
        try {
            zone = ZoneId.of(tz);
        } catch (Exception e) {
            log.warn("[PipelineReport] Invalid institute timezone '{}', falling back to Asia/Kolkata", tz);
            zone = ZoneId.of("Asia/Kolkata");
        }
        LocalDate today = LocalDate.now(zone);
        LocalDate to = parseOr(toDate, today);
        LocalDate from = parseOr(fromDate, to.minusDays(DEFAULT_RANGE_DAYS - 1L));
        return new Window(
                Timestamp.valueOf(from.atStartOfDay(zone).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime()),
                Timestamp.valueOf(to.plusDays(1).atStartOfDay(zone).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime()));
    }

    private static LocalDate parseOr(String iso, LocalDate fallback) {
        if (iso == null || iso.isBlank()) return fallback;
        try {
            return LocalDate.parse(iso.trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    /**
     * Common binds. scopeCsv is typed VARCHAR explicitly so a null bind keeps Postgres able to
     * infer the parameter type inside both ":scopeCsv IS NULL" and STRING_TO_ARRAY.
     */
    private static MapSqlParameterSource baseParams(String instituteId, Window w, String scopeCsv, String audienceId) {
        return new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("fromTs", w.fromUtc(), Types.TIMESTAMP)
                .addValue("toTs", w.toUtc(), Types.TIMESTAMP)
                .addValue("scopeCsv", scopeCsv, Types.VARCHAR)
                .addValue("audienceId", trimToNull(audienceId), Types.VARCHAR);
    }

    /** Empty set → "" → STRING_TO_ARRAY('', ',') = {} → matches nothing (defaults make this moot). */
    private static String joinSet(Set<String> values) {
        return CollectionUtils.isEmpty(values) ? "" : String.join(",", values);
    }

    /** One auth-service batch; failures degrade to id-as-name instead of 500ing the report. */
    private Map<String, String> resolveNames(Collection<String> userIds) {
        List<String> ids = userIds.stream()
                .filter(s -> s != null && !s.isBlank())
                .distinct()
                .collect(Collectors.toList());
        if (ids.isEmpty()) return Collections.emptyMap();
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(ids);
            if (CollectionUtils.isEmpty(users)) return Collections.emptyMap();
            return users.stream()
                    .filter(u -> u != null && u.getId() != null)
                    .collect(Collectors.toMap(UserDTO::getId, u ->
                            Optional.ofNullable(u.getFullName()).orElse(u.getId()), (a, b) -> a));
        } catch (Exception ex) {
            log.warn("[PipelineReport] Failed to resolve user names: {}", ex.getMessage());
            return Collections.emptyMap();
        }
    }

    private static String displayName(String userId, Map<String, String> nameById) {
        if (SYSTEM_ACTOR_ID.equals(userId)) return SYSTEM_ACTOR_NAME;
        if (UNASSIGNED_ACTOR_ID.equals(userId)) return UNASSIGNED_ACTOR_NAME;
        return Optional.ofNullable(nameById.get(userId)).filter(s -> !s.isBlank()).orElse(userId);
    }

    private static String trimToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    /**
     * The ACTIVE counsellor-role users inside the resolved report scope — the
     * roster per-counsellor report rows must render even with zero activity.
     * Intersected with the role roster because a teamId-filtered scope CSV can
     * carry non-counsellor team members. Empty when the scope is unfiltered
     * (setup mode — nothing sensible to pad with).
     */
    private java.util.List<String> scopedActiveCounsellors(String instituteId, String scopeCsv) {
        if (scopeCsv == null || scopeCsv.isBlank()) return java.util.List.of();
        Set<String> counsellors = new java.util.HashSet<>(
                counsellorScopeService.allCounsellorUserIds(instituteId));
        return java.util.Arrays.stream(scopeCsv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty() && counsellors.contains(s))
                .distinct()
                .collect(Collectors.toList());
    }

    /** numerator/denominator * 100, one decimal; null when denominator is 0. */
    private static Double percentage(long num, long denom) {
        if (denom == 0) return null;
        return Math.round((num * 1000.0) / denom) / 10.0;
    }

    private static Double round1(Double v) {
        return v == null ? null : Math.round(v * 10.0) / 10.0;
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private static Double getNullableDouble(java.sql.ResultSet rs, String col) throws java.sql.SQLException {
        double v = rs.getDouble(col);
        return rs.wasNull() ? null : v;
    }

    /** UTC wall-clock window bounds: [fromUtc, toUtc). */
    private record Window(Timestamp fromUtc, Timestamp toUtc) {
    }
}
