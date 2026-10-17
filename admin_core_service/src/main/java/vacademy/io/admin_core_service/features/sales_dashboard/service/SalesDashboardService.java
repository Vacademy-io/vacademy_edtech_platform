package vacademy.io.admin_core_service.features.sales_dashboard.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counsellor_rating.dto.LeaderboardEntryDTO;
import vacademy.io.admin_core_service.features.counsellor_rating.service.CounsellorRatingService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.sales_dashboard.dto.*;
import vacademy.io.common.auth.dto.UserDTO;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;

/**
 * Read-only aggregates powering the sales dashboard widgets.
 *
 * Every endpoint accepts optional teamId. When supplied, the query is scoped
 * to leads assigned to anyone in that team's subtree (resolved via
 * CounsellorScopeService). When omitted, the institute-wide totals are
 * returned — and the controller layer is responsible for gating that on the
 * SALES_DASHBOARD_VIEW_ALL_TEAMS permission.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SalesDashboardService {

    private final JdbcTemplate jdbc;
    private final CounsellorScopeService scopeService;
    private final CounsellorRatingService ratingService;
    private final AuthService authService;

    // ────────────────────────────────────────────────────────────────
    // KPI band
    // ────────────────────────────────────────────────────────────────

    public KpiDTO kpi(String instituteId, String teamId, Timestamp from, Timestamp to, String callerUserId) {
        List<String> users = scopedUsers(instituteId, teamId, callerUserId);
        String userClause = userScopeClause(users);
        Object[] argsBase = new Object[]{instituteId};

        Long totalLeads = jdbc.queryForObject(
                "SELECT COUNT(*) FROM user_lead_profile WHERE institute_id = ? " +
                        andDateRange("created_at", from, to) + userClause,
                Long.class, argsWithRange(argsBase, from, to, users));
        Long openLeads = jdbc.queryForObject(
                "SELECT COUNT(*) FROM user_lead_profile WHERE institute_id = ? AND conversion_status = 'LEAD'" +
                        userClause,
                Long.class, argsConcat(argsBase, users));
        Long conversions = jdbc.queryForObject(
                "SELECT COUNT(*) FROM user_lead_profile WHERE institute_id = ? AND conversion_status = 'CONVERTED'" +
                        andDateRange("converted_at", from, to) + userClause,
                Long.class, argsWithRange(argsBase, from, to, users));

        BigDecimal rate = (totalLeads != null && totalLeads > 0)
                ? BigDecimal.valueOf(conversions != null ? conversions : 0)
                    .multiply(BigDecimal.valueOf(100))
                    .divide(BigDecimal.valueOf(totalLeads), 2, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;

        Long activeCounsellors = jdbc.queryForObject(
                "SELECT COUNT(DISTINCT cpm.counselor_user_id) FROM counselor_pool_member cpm " +
                        " JOIN counselor_pool cp ON cp.id = cpm.pool_id " +
                        "WHERE cp.institute_id = ? AND cpm.status = 'ACTIVE'",
                Long.class, instituteId);

        Long overdueFollowups = jdbc.queryForObject(
                "SELECT COUNT(*) FROM lead_followup lf " +
                        "WHERE lf.institute_id = ? " +
                        "  AND lf.is_closed = false " +
                        "  AND (lf.status = 'OVERDUE' OR " +
                        "       (lf.status = 'PENDING' AND lf.schedule_time < NOW()))",
                Long.class, instituteId);

        return KpiDTO.builder()
                .totalLeads(nz(totalLeads))
                .openLeads(nz(openLeads))
                .conversions(nz(conversions))
                .conversionRate(rate)
                .activeCounsellors(nz(activeCounsellors))
                .overdueFollowups(nz(overdueFollowups))
                .build();
    }

    // ────────────────────────────────────────────────────────────────
    // Conversion funnel
    // ────────────────────────────────────────────────────────────────

    public List<FunnelStageDTO> conversionFunnel(String instituteId, String teamId,
                                                 Timestamp from, Timestamp to, String callerUserId) {
        List<String> users = scopedUsers(instituteId, teamId, callerUserId);
        String userClause = userScopeClause(users, "ulp.assigned_counselor_id");
        // Pipeline stages from lead_status; counts come from the latest status
        // each lead is currently in (via user_lead_profile.conversion_status
        // when no custom status, otherwise via the latest audience_response).
        // The date-range and user-scope predicates are inside the WHERE so the
        // parameter order matches the args list: [instituteId, from?, to?,
        // users…, instituteId-for-lead_status].
        String dateClause = andDateRange("ulp.created_at", from, to);
        // lead_status uses display_order (not sort_order) and is_active boolean
        // (not status). See LeadStatus entity.
        String sql = "SELECT ls.status_key, ls.label, ls.color, ls.display_order, " +
                "       COUNT(DISTINCT ulp.id) AS lead_count " +
                "FROM lead_status ls " +
                "LEFT JOIN audience_response ar ON ar.lead_status_id = ls.id " +
                "LEFT JOIN user_lead_profile ulp ON ulp.user_id = ar.user_id " +
                "    AND ulp.institute_id = ?" +
                dateClause +
                userClause +
                "WHERE ls.institute_id = ? AND ls.is_active = true " +
                "GROUP BY ls.status_key, ls.label, ls.color, ls.display_order " +
                "ORDER BY ls.display_order";

        List<Object> args = new ArrayList<>();
        args.add(instituteId);                                 // ulp.institute_id in JOIN
        if (from != null) args.add(from);
        if (to != null) args.add(to);
        args.addAll(users);
        args.add(instituteId);                                 // ls.institute_id in WHERE

        return jdbc.query(sql,
                (rs, rowNum) -> FunnelStageDTO.builder()
                        .statusKey(rs.getString("status_key"))
                        .label(rs.getString("label"))
                        .color(rs.getString("color"))
                        .count(rs.getLong("lead_count"))
                        .order(rs.getInt("display_order"))
                        .build(),
                args.toArray());
    }

    // ────────────────────────────────────────────────────────────────
    // Conversion by source
    // ────────────────────────────────────────────────────────────────

    /**
     * Where conversions are coming from. Per source_type (the audience_response
     * tag — META / GOOGLE / ORGANIC / etc.) we count both inbound lead volume
     * and the converted subset, so the UI can render a conversion-rate %.
     *
     * Scoped via the same caller/team rules as the funnel — see {@link #scopedUsers}.
     */
    public List<SourceConversionDTO> conversionBySource(String instituteId, String teamId,
                                                        Timestamp from, Timestamp to,
                                                        String callerUserId, String counsellorUserId) {
        // counsellorUserId is the "scope to this single person" override —
        // used by the counsellors detail drawer. RBAC still applies (caller
        // can only narrow within their own descendant set), so we intersect
        // the override against the caller's scope.
        List<String> users = counsellorUserId != null && !counsellorUserId.isBlank()
                ? narrowToCounsellor(instituteId, callerUserId, counsellorUserId)
                : scopedUsers(instituteId, teamId, callerUserId);
        String userClause = userScopeClause(users, "ulp.assigned_counselor_id");
        String dateClause = andDateRange("ulp.created_at", from, to);

        String sql = "SELECT COALESCE(ar.source_type, 'unknown') AS source, " +
                "       COUNT(DISTINCT ulp.id) AS leads, " +
                "       COUNT(DISTINCT CASE WHEN ulp.conversion_status = 'CONVERTED' THEN ulp.id END) AS conversions " +
                "FROM user_lead_profile ulp " +
                "LEFT JOIN audience_response ar ON ar.user_id = ulp.user_id " +
                "WHERE ulp.institute_id = ? " +
                dateClause +
                userClause +
                "GROUP BY COALESCE(ar.source_type, 'unknown') " +
                "ORDER BY leads DESC";

        List<Object> args = new ArrayList<>();
        args.add(instituteId);
        if (from != null) args.add(from);
        if (to != null) args.add(to);
        args.addAll(users);

        return jdbc.query(sql, (rs, rowNum) -> {
            long leads = rs.getLong("leads");
            long conv = rs.getLong("conversions");
            double rate = leads > 0 ? Math.round(1000.0 * conv / leads) / 10.0 : 0.0;
            return SourceConversionDTO.builder()
                    .source(rs.getString("source"))
                    .leads(leads)
                    .conversions(conv)
                    .conversionRate(rate)
                    .build();
        }, args.toArray());
    }

    // ────────────────────────────────────────────────────────────────
    // Calls per day
    // ────────────────────────────────────────────────────────────────

    /**
     * Daily count of calls placed by the in-scope counsellors. Reuses
     * {@link TimeSeriesPointDTO} (date + primary count) since the shape is
     * identical to the reassignment-volume widget.
     *
     * Use case: the CSO wants to see how many calls a counsellor (or their
     * team) made in a day — drives the "how active is my team" widget.
     */
    public List<TimeSeriesPointDTO> callsPerDay(String instituteId, String teamId,
                                                Timestamp from, Timestamp to,
                                                String callerUserId, String counsellorUserId) {
        // See conversionBySource — same RBAC-intersected single-user narrow.
        List<String> users = counsellorUserId != null && !counsellorUserId.isBlank()
                ? narrowToCounsellor(instituteId, callerUserId, counsellorUserId)
                : scopedUsers(instituteId, teamId, callerUserId);
        String userClause = userScopeClause(users, "tcl.counsellor_user_id");
        String dateClause = andDateRange("tcl.start_time", from, to);

        String sql = "SELECT DATE(tcl.start_time) AS day, COUNT(*) AS n " +
                "FROM telephony_call_log tcl " +
                "WHERE tcl.institute_id = ? " +
                "  AND tcl.start_time IS NOT NULL " +
                dateClause +
                userClause +
                "GROUP BY DATE(tcl.start_time) " +
                "ORDER BY day";

        List<Object> args = new ArrayList<>();
        args.add(instituteId);
        if (from != null) args.add(from);
        if (to != null) args.add(to);
        args.addAll(users);

        return jdbc.query(sql,
                (rs, rowNum) -> TimeSeriesPointDTO.builder()
                        .date(rs.getDate("day").toLocalDate())
                        .primary(rs.getLong("n"))
                        .build(),
                args.toArray());
    }

    // ────────────────────────────────────────────────────────────────
    // Reassignment volume (daily series)
    // ────────────────────────────────────────────────────────────────

    public List<TimeSeriesPointDTO> reassignmentSeries(String instituteId, Timestamp from, Timestamp to) {
        // Counts only OUT events to avoid double-counting (the pair (OUT, IN)
        // we write per transfer would otherwise show 2x).
        //
        // NOTE: PostgreSQL's jsonb "?" key-exists operator collides with
        // JDBC's "?" parameter placeholder — Spring JdbcTemplate counts
        // every ? as a bind variable and the prepared statement explodes.
        // We use the equivalent `->> 'key' IS NOT NULL` form instead, which
        // is just as cheap and contains no ambiguous ?.
        // action_type stores the enum NAME (TimelineEventService writes
        // actionType.name()) — so the value is 'COUNSELOR_ASSIGNED', not the
        // human title 'Counselor reassigned'. Initial assigns vs. reassigns
        // share the same enum; the metadata "reassigned_from" key is what
        // distinguishes a reassign event, and it's already in the WHERE.
        // type_id on USER_LEAD_PROFILE events is user_lead_profile.id (not the
        // raw user_id — timeline_event has no institute_id column, and a
        // user_id alone can now resolve to a profile per institute), so we
        // join through user_lead_profile to scope by institute and stop the
        // widget from leaking other tenants' reassignment counts.
        return jdbc.query(
                "SELECT DATE(te.created_at) AS day, COUNT(*) AS n " +
                "FROM timeline_event te " +
                "JOIN user_lead_profile ulp ON ulp.id = te.type_id " +
                "WHERE te.action_type = 'COUNSELOR_ASSIGNED' " +
                "  AND te.type = 'USER_LEAD_PROFILE' " +
                "  AND ulp.institute_id = ? " +
                "  AND te.created_at >= ? AND te.created_at < ? " +
                "  AND (te.metadata_json::jsonb ->> 'reassigned_from') IS NOT NULL " +
                "  AND (te.metadata_json::jsonb ->> 'trigger') IS NOT NULL " +
                "GROUP BY DATE(te.created_at) " +
                "ORDER BY day",
                (rs, rowNum) -> TimeSeriesPointDTO.builder()
                        .date(rs.getDate("day").toLocalDate())
                        .primary(rs.getLong("n"))
                        .build(),
                instituteId, from, to);
    }

    // ────────────────────────────────────────────────────────────────
    // Followups (upcoming + missed)
    // ────────────────────────────────────────────────────────────────

    public List<FollowupRowDTO> upcomingFollowups(String instituteId, String teamId, int hoursAhead, int limit, String callerUserId) {
        List<String> users = scopedUsers(instituteId, teamId, callerUserId);
        String userClause = userScopeClause(users, "lf.created_by");
        // No JOIN to users — admin_core and auth_service own separate
        // databases on stage/prod. We project ar.user_id as lead_user_id and
        // hydrate name/full_name in the service layer via AuthService, same
        // pattern as AudienceService.mapResponsesToLeadDetails.
        List<FollowupRowDTO> rows = jdbc.query(
                "SELECT lf.id AS followup_id, " +
                "       ulp.id AS lead_id, " +
                "       ar.user_id AS lead_user_id, " +
                "       lf.created_by AS counsellor_id, " +
                "       lf.schedule_time, lf.status, lf.content, " +
                "       EXTRACT(EPOCH FROM (lf.schedule_time - NOW())) / 60 AS minutes_until_due " +
                "FROM lead_followup lf " +
                "JOIN audience_response ar ON ar.id = lf.audience_response_id " +
                "LEFT JOIN user_lead_profile ulp ON ulp.user_id = ar.user_id AND ulp.institute_id = lf.institute_id " +
                "WHERE lf.institute_id = ? " +
                "  AND lf.is_closed = false " +
                "  AND lf.status = 'PENDING' " +
                // (? || ' hours')::interval fails because JDBC binds the hours
                // arg as int4, and Postgres' || requires text on both sides.
                // int * interval is a native operator — no cast gymnastics.
                "  AND lf.schedule_time BETWEEN NOW() AND NOW() + (? * INTERVAL '1 hour') " +
                userClause +
                "ORDER BY lf.schedule_time ASC " +
                "LIMIT ?",
                (rs, rowNum) -> followupFromRow(rs),
                argsForFollowups(instituteId, hoursAhead, users, limit));
        return hydrateFollowupNames(rows);
    }

    public List<FollowupRowDTO> missedFollowups(String instituteId, String teamId, int limit, String callerUserId) {
        List<String> users = scopedUsers(instituteId, teamId, callerUserId);
        String userClause = userScopeClause(users, "lf.created_by");
        List<FollowupRowDTO> rows = jdbc.query(
                "SELECT lf.id AS followup_id, " +
                "       ulp.id AS lead_id, " +
                "       ar.user_id AS lead_user_id, " +
                "       lf.created_by AS counsellor_id, " +
                "       lf.schedule_time, lf.status, lf.content, " +
                "       EXTRACT(EPOCH FROM (lf.schedule_time - NOW())) / 60 AS minutes_until_due " +
                "FROM lead_followup lf " +
                "JOIN audience_response ar ON ar.id = lf.audience_response_id " +
                "LEFT JOIN user_lead_profile ulp ON ulp.user_id = ar.user_id AND ulp.institute_id = lf.institute_id " +
                "WHERE lf.institute_id = ? " +
                "  AND lf.is_closed = false " +
                "  AND (lf.status = 'OVERDUE' OR (lf.status = 'PENDING' AND lf.schedule_time < NOW())) " +
                userClause +
                "ORDER BY lf.schedule_time ASC " +
                "LIMIT ?",
                (rs, rowNum) -> followupFromRow(rs),
                argsForMissed(instituteId, users, limit));
        return hydrateFollowupNames(rows);
    }

    // ────────────────────────────────────────────────────────────────
    // New vs existing leads (daily)
    // ────────────────────────────────────────────────────────────────

    public List<TimeSeriesPointDTO> newVsExisting(String instituteId, String teamId,
                                                  Timestamp from, Timestamp to, String callerUserId) {
        List<String> users = scopedUsers(instituteId, teamId, callerUserId);
        // "new" = lead created within [from, to). "existing" = lead created
        // before from but had any activity (timeline_event) within [from, to).
        String userClause = userScopeClause(users, "ulp.assigned_counselor_id");
        // First series: new leads per day.
        Map<LocalDate, long[]> byDay = new TreeMap<>();
        // Arg order matches SQL: institute_id, from, to, then the IN-list
        // users from userClause. The previous order [institute_id, users,
        // from, to] caused bad-SQL-grammar because the dates were bound to
        // the IN placeholders.
        jdbc.query("SELECT DATE(ulp.created_at) AS day, COUNT(*) AS n " +
                        "FROM user_lead_profile ulp " +
                        "WHERE ulp.institute_id = ? " +
                        "  AND ulp.created_at >= ? AND ulp.created_at < ? " +
                        userClause +
                        "GROUP BY DATE(ulp.created_at) ORDER BY day",
                rs -> {
                    LocalDate d = rs.getDate("day").toLocalDate();
                    long[] arr = byDay.computeIfAbsent(d, k -> new long[]{0, 0});
                    arr[0] = rs.getLong("n");
                },
                argsConcat(new Object[]{instituteId, from, to}, users));

        // Second series: existing leads with activity per day (count of
        // distinct lead-user_ids that had timeline_event in the window and
        // were created before the window).
        //
        // type_id for USER_LEAD_PROFILE events is user_lead_profile.id (see
        // AudienceController + CounsellorReassignService callers), NOT the raw
        // user_id, so the join is ulp.id = te.type_id and we filter to type =
        // 'USER_LEAD_PROFILE' so we don't accidentally pick up unrelated
        // entity types whose type_id may collide.
        jdbc.query("SELECT DATE(te.created_at) AS day, COUNT(DISTINCT te.type_id) AS n " +
                        "FROM timeline_event te " +
                        "JOIN user_lead_profile ulp ON ulp.id = te.type_id " +
                        "WHERE te.type = 'USER_LEAD_PROFILE' " +
                        "  AND ulp.institute_id = ? " +
                        "  AND te.created_at >= ? AND te.created_at < ? " +
                        "  AND ulp.created_at < ? " +
                        userClause +
                        "GROUP BY DATE(te.created_at) ORDER BY day",
                rs -> {
                    LocalDate d = rs.getDate("day").toLocalDate();
                    long[] arr = byDay.computeIfAbsent(d, k -> new long[]{0, 0});
                    arr[1] = rs.getLong("n");
                },
                argsConcat(new Object[]{instituteId, from, to, from}, users));

        List<TimeSeriesPointDTO> out = new ArrayList<>(byDay.size());
        for (Map.Entry<LocalDate, long[]> e : byDay.entrySet()) {
            out.add(TimeSeriesPointDTO.builder()
                    .date(e.getKey()).primary(e.getValue()[0]).secondary(e.getValue()[1]).build());
        }
        return out;
    }

    // ────────────────────────────────────────────────────────────────
    // Campaign cards
    // ────────────────────────────────────────────────────────────────

    public List<CampaignCardDTO> campaignCards(String instituteId, String period) {
        long since = switch (period == null ? "WEEK" : period.toUpperCase(Locale.ROOT)) {
            case "DAY" -> System.currentTimeMillis() - 24L * 3600 * 1000;
            case "MONTH" -> System.currentTimeMillis() - 30L * 24 * 3600 * 1000;
            case "WEEK" -> System.currentTimeMillis() - 7L * 24 * 3600 * 1000;
            default -> System.currentTimeMillis() - 7L * 24 * 3600 * 1000;
        };
        Timestamp sinceTs = new Timestamp(since);

        return jdbc.query(
                "SELECT a.id AS campaign_id, a.campaign_name, a.campaign_type, " +
                "       COUNT(DISTINCT ar.id) AS leads_in_window, " +
                "       COUNT(DISTINCT CASE WHEN ulp.conversion_status = 'CONVERTED' THEN ulp.id END) AS conversions, " +
                "       (SELECT ulp2.assigned_counselor_id FROM user_lead_profile ulp2 " +
                "          JOIN audience_response ar2 ON ar2.user_id = ulp2.user_id " +
                "         WHERE ar2.audience_id = a.id AND ar2.created_at >= ? AND ulp2.conversion_status = 'CONVERTED' " +
                "         GROUP BY ulp2.assigned_counselor_id ORDER BY COUNT(*) DESC LIMIT 1) AS top_counsellor_user_id, " +
                "       (SELECT COUNT(*) FROM user_lead_profile ulp3 " +
                "          JOIN audience_response ar3 ON ar3.user_id = ulp3.user_id " +
                "         WHERE ar3.audience_id = a.id AND ar3.created_at >= ? AND ulp3.conversion_status = 'CONVERTED' " +
                "         GROUP BY ulp3.assigned_counselor_id ORDER BY COUNT(*) DESC LIMIT 1) AS top_counsellor_conversions " +
                "FROM audience a " +
                "LEFT JOIN audience_response ar ON ar.audience_id = a.id AND ar.created_at >= ? " +
                "LEFT JOIN user_lead_profile ulp ON ulp.user_id = ar.user_id AND ulp.institute_id = a.institute_id " +
                // Exclude soft-deleted campaigns (AudienceService.deleteCampaign
                // sets status='DELETED' per CampaignStatusEnum). Without this
                // filter the dashboard surfaces ghost cards for campaigns the
                // admin already deleted in /audience.
                "WHERE a.institute_id = ? AND (a.status IS NULL OR a.status <> 'DELETED') " +
                "GROUP BY a.id, a.campaign_name, a.campaign_type " +
                "ORDER BY leads_in_window DESC " +
                "LIMIT 20",
                (rs, rowNum) -> {
                    Long leadsN = rs.getLong("leads_in_window");
                    Long convN = rs.getLong("conversions");
                    BigDecimal rate = leadsN > 0
                            ? BigDecimal.valueOf(convN).multiply(BigDecimal.valueOf(100))
                                .divide(BigDecimal.valueOf(leadsN), 2, RoundingMode.HALF_UP)
                            : BigDecimal.ZERO;
                    return CampaignCardDTO.builder()
                            .campaignId(rs.getString("campaign_id"))
                            .campaignName(rs.getString("campaign_name"))
                            .campaignType(rs.getString("campaign_type"))
                            .leadsInWindow(leadsN)
                            .conversionsInWindow(convN)
                            .conversionRate(rate)
                            .topCounsellorUserId(rs.getString("top_counsellor_user_id"))
                            .topCounsellorConversions(getNullableLong(rs, "top_counsellor_conversions"))
                            .build();
                },
                sinceTs, sinceTs, sinceTs, instituteId);
    }

    // ────────────────────────────────────────────────────────────────
    // Counsellor leaderboard (delegates)
    // ────────────────────────────────────────────────────────────────

    public List<LeaderboardEntryDTO> counsellorLeaderboard(String instituteId, String teamId, int limit) {
        return ratingService.leaderboard(instituteId, teamId, limit);
    }

    // ────────────────────────────────────────────────────────────────
    // Insights (deterministic, NOT LLM)
    // ────────────────────────────────────────────────────────────────

    public List<InsightDTO> insights(String instituteId, String teamId) {
        List<InsightDTO> out = new ArrayList<>();
        // WoW conversion rate change.
        try {
            Double thisWeek = jdbc.queryForObject(
                    "SELECT 100.0 * AVG(CASE WHEN conversion_status='CONVERTED' THEN 1 ELSE 0 END) " +
                            "FROM user_lead_profile WHERE institute_id = ? " +
                            "  AND created_at >= NOW() - INTERVAL '7 days'",
                    Double.class, instituteId);
            Double lastWeek = jdbc.queryForObject(
                    "SELECT 100.0 * AVG(CASE WHEN conversion_status='CONVERTED' THEN 1 ELSE 0 END) " +
                            "FROM user_lead_profile WHERE institute_id = ? " +
                            "  AND created_at >= NOW() - INTERVAL '14 days' " +
                            "  AND created_at <  NOW() - INTERVAL '7 days'",
                    Double.class, instituteId);
            if (thisWeek != null && lastWeek != null && lastWeek > 0) {
                double delta = ((thisWeek - lastWeek) / lastWeek) * 100.0;
                String sev = delta >= 0 ? "SUCCESS" : "WARN";
                out.add(InsightDTO.builder().key("CONVERSION_WOW").severity(sev)
                        .headline(String.format(Locale.US, "Conversion rate %.1f%% (%s%.1f%% WoW)",
                                thisWeek, delta >= 0 ? "+" : "", delta))
                        .detail("Rolling 7-day vs prior 7-day window.").build());
            }
        } catch (Exception e) {
            log.debug("WoW insight failed: {}", e.getMessage());
        }
        // Overdue followups spike.
        try {
            Long overdue = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM lead_followup WHERE institute_id = ? " +
                            "AND is_closed=false " +
                            "AND (status='OVERDUE' OR (status='PENDING' AND schedule_time < NOW()))",
                    Long.class, instituteId);
            if (overdue != null && overdue > 0) {
                out.add(InsightDTO.builder().key("OVERDUE_SPIKE")
                        .severity(overdue > 10 ? "DANGER" : "WARN")
                        .headline(overdue + " missed followups")
                        .detail("Open the Missed Followups widget to act.").build());
            }
        } catch (Exception e) {
            log.debug("Overdue insight failed: {}", e.getMessage());
        }
        return out;
    }

    // ────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────

    /**
     * Resolve the user-id whitelist the dashboard should count against.
     *
     * Priority:
     *   1. Explicit {@code teamId} → that team's members only (manager picks
     *      a specific team to drill into).
     *   2. Hierarchy-scoped caller (COUNSELLOR role) → their scope: self +
     *      counsellor-role descendants. A team head sees their entire
     *      downstream; a leaf counsellor sees only themselves. Without this,
     *      the funnel/KPIs would silently count every counsellor in the
     *      institute regardless of who's logged in.
     *   3. Pure admin → every COUNSELLOR-role user; when the institute has
     *      no counsellor-role users yet, empty list, which
     *      {@link #userScopeClause} translates to "no scope filter" (the
     *      page still renders during admin setup).
     */
    private List<String> scopedUsers(String instituteId, String teamId, String callerUserId) {
        if (teamId != null && !teamId.isBlank()) {
            List<String> teamUsers = scopeService.usersInTeams(java.util.List.of(teamId));
            // A scoped caller may only drill into the part of a team inside their own scope.
            if (callerUserId != null && !callerUserId.isBlank()
                    && scopeService.isScopedCaller(instituteId, callerUserId)) {
                Set<String> allowed = new HashSet<>(
                        scopeService.scopedCounsellorUserIds(instituteId, callerUserId));
                teamUsers = teamUsers.stream().filter(allowed::contains).toList();
            }
            // An empty team (or none of it in scope) means zero rows, never "no filter".
            return teamUsers.isEmpty() ? NO_USERS : teamUsers;
        }
        if (callerUserId != null && !callerUserId.isBlank()
                && scopeService.isScopedCaller(instituteId, callerUserId)) {
            List<String> scope = scopeService.scopedCounsellorUserIds(instituteId, callerUserId);
            if (!scope.isEmpty()) return scope;
        }
        return scopeService.allCounsellorUserIds(instituteId);
    }

    /** Back-compat overload for paths that don't carry caller context (e.g. scheduled aggregations). */
    private List<String> scopedUsers(String instituteId, String teamId) {
        return scopedUsers(instituteId, teamId, null);
    }

    /**
     * "Scope to this single counsellor" override used by the per-counsellor
     * widgets in the detail drawer. Returns {@link #NO_USERS} (zero rows) when the requested counsellor is
     * outside the caller's RBAC subtree, so the widget renders empty instead of
     * throwing and never widens to the whole institute.
     */
    private List<String> narrowToCounsellor(String instituteId, String callerUserId, String counsellorUserId) {
        if (callerUserId != null && !callerUserId.isBlank()
                && scopeService.isScopedCaller(instituteId, callerUserId)) {
            Set<String> allowed = new HashSet<>(
                    scopeService.scopedCounsellorUserIds(instituteId, callerUserId));
            if (!allowed.contains(counsellorUserId)) {
                // Outside the caller's scope: zero rows. An empty list would mean "no filter".
                return NO_USERS;
            }
        }
        return List.of(counsellorUserId);
    }

    /**
     * Matches no user id, so the scope clause yields zero rows. Used where an empty
     * scope must mean nothing visible; a plain empty list means no filter at all.
     */
    private static final List<String> NO_USERS = List.of("__no_user__");

    private String userScopeClause(List<String> users) {
        return userScopeClause(users, "assigned_counselor_id");
    }

    private String userScopeClause(List<String> users, String column) {
        if (users == null || users.isEmpty()) return " ";
        String placeholders = String.join(",", Collections.nCopies(users.size(), "?"));
        return " AND " + column + " IN (" + placeholders + ") ";
    }

    private String andDateRange(String column, Timestamp from, Timestamp to) {
        StringBuilder sb = new StringBuilder();
        if (from != null) sb.append(" AND ").append(column).append(" >= ?");
        if (to != null) sb.append(" AND ").append(column).append(" < ?");
        return sb.toString();
    }

    private Object[] argsWithRange(Object[] base, Timestamp from, Timestamp to, List<String> users) {
        return argsConcatTail(argsConcat(base, addRange(from, to)), users.toArray());
    }

    private Object[] argsConcat(Object[] base, Collection<String> tail) {
        Object[] out = Arrays.copyOf(base, base.length + tail.size());
        int i = base.length;
        for (String s : tail) out[i++] = s;
        return out;
    }

    private Object[] argsConcat(Object[] base, Object[] tail) {
        Object[] out = Arrays.copyOf(base, base.length + tail.length);
        System.arraycopy(tail, 0, out, base.length, tail.length);
        return out;
    }

    private Object[] argsConcatTail(Object[] base, Object... tail) {
        return argsConcat(base, tail);
    }

    private List<Object> addRange(Timestamp from, Timestamp to) {
        List<Object> out = new ArrayList<>(2);
        if (from != null) out.add(from);
        if (to != null) out.add(to);
        return out;
    }

    @SuppressWarnings("unchecked")
    private Object[] argsConcat(Object[] base, List<Object> mid) {
        Object[] out = Arrays.copyOf(base, base.length + mid.size());
        for (int i = 0; i < mid.size(); i++) out[base.length + i] = mid.get(i);
        return out;
    }

    private Object[] argsForFollowups(String instituteId, int hoursAhead, List<String> users, int limit) {
        List<Object> args = new ArrayList<>();
        args.add(instituteId);
        args.add(hoursAhead);
        args.addAll(users);
        args.add(limit);
        return args.toArray();
    }

    private Object[] argsForMissed(String instituteId, List<String> users, int limit) {
        List<Object> args = new ArrayList<>();
        args.add(instituteId);
        args.addAll(users);
        args.add(limit);
        return args.toArray();
    }

    private FollowupRowDTO followupFromRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        // leadName + counsellorName are filled in by hydrateFollowupNames
        // after a single auth-service batch call. leadUserId is the key.
        return FollowupRowDTO.builder()
                .followupId(rs.getString("followup_id"))
                .leadId(rs.getString("lead_id"))
                .leadUserId(rs.getString("lead_user_id"))
                .counsellorUserId(rs.getString("counsellor_id"))
                .scheduleTime(rs.getTimestamp("schedule_time"))
                .status(rs.getString("status"))
                .content(rs.getString("content"))
                .minutesUntilDue(getNullableLong(rs, "minutes_until_due"))
                .build();
    }

    /**
     * Batch-hydrate lead and counsellor display names via auth-service.
     * admin_core and auth_service own separate Postgres databases on
     * stage/prod, so admin_core CANNOT join to `users` directly — same
     * cross-service pattern as AudienceService.mapResponsesToLeadDetails.
     * One HTTP call per page; an auth-service failure leaves names null
     * rather than 500ing the widget.
     */
    private List<FollowupRowDTO> hydrateFollowupNames(List<FollowupRowDTO> rows) {
        if (rows == null || rows.isEmpty()) return rows;
        Set<String> userIds = new HashSet<>();
        for (FollowupRowDTO r : rows) {
            if (r.getLeadUserId() != null) userIds.add(r.getLeadUserId());
            if (r.getCounsellorUserId() != null) userIds.add(r.getCounsellorUserId());
        }
        if (userIds.isEmpty()) return rows;
        Map<String, UserDTO> userById;
        try {
            userById = authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(userIds)).stream()
                    .filter(Objects::nonNull)
                    .filter(u -> u.getId() != null)
                    .collect(java.util.stream.Collectors.toMap(UserDTO::getId, u -> u, (a, b) -> a));
        } catch (Exception e) {
            log.warn("Followup name hydration failed: {}", e.getMessage());
            return rows;
        }
        for (FollowupRowDTO r : rows) {
            UserDTO lead = r.getLeadUserId() != null ? userById.get(r.getLeadUserId()) : null;
            UserDTO counsellor = r.getCounsellorUserId() != null
                    ? userById.get(r.getCounsellorUserId()) : null;
            if (lead != null) r.setLeadName(lead.getFullName());
            if (counsellor != null) r.setCounsellorName(counsellor.getFullName());
        }
        return rows;
    }

    private static Long getNullableLong(java.sql.ResultSet rs, String col) throws java.sql.SQLException {
        long v = rs.getLong(col);
        return rs.wasNull() ? null : v;
    }

    private static long nz(Long v) {
        return v != null ? v : 0L;
    }
}
