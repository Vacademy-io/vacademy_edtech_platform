package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.reports.ActivityTimelineReportDTO;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Counsellor activity-timeline report for the Reports Center (Activity tab):
 * per-counsellor activity volume over a window, broken down by type, plus a
 * daily total series across the scope.
 *
 * Raw JdbcTemplate SQL (same pattern as {@link CallingReportService}) —
 * read-only, never writes. Invariants honored here:
 *   - never JOIN users: names hydrated via the AuthService batch lookup;
 *   - each source is scoped on its ACTOR id (the counsellor who performed the
 *     activity), and windowed on the activity timestamp;
 *   - timestamps are stored as UTC wall-clock in `timestamp` columns, so all
 *     day bucketing is (col AT TIME ZONE 'UTC' AT TIME ZONE :tz) with the
 *     institute timezone from {@link LeadReportSettingService};
 *   - lead-linked sources (status changes, follow-ups) exclude OPTED_OUT leads
 *     via the audience_response join; timeline_event ACTIVITY rows are counted
 *     per actor without an opt-out join (they are actor activity, not lead-keyed);
 *   - RBAC scope CSV from {@link ReportScopeResolver}: null = no filter,
 *     "" matches nothing (zeroed report).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ActivityReportService {

    private final NamedParameterJdbcTemplate jdbc;
    private final ReportScopeResolver reportScopeResolver;
    private final LeadReportSettingService leadReportSettingService;
    private final AuthService authService;

    /** Mirrors CallingReportService — last 30 days when from/to omitted. */
    private static final int DEFAULT_RANGE_DAYS = 30;
    private static final ZoneId FALLBACK_ZONE = ZoneId.of("Asia/Kolkata");

    // ─────────────────────────────────────────────────────────────────────
    // SQL — one row per (actor, day) per source. Window params are UTC instants
    // (institute-TZ day bounds converted in Java); the day bucket is the
    // institute-TZ calendar date of the activity timestamp.
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Manual admin interactions: notes/call-logs/meetings logged on the
     * timeline. category = ACTIVITY excludes automated JOURNEY lifecycle events.
     * actor_id is the user who performed the action; rows with a null actor are
     * dropped (no counsellor to attribute).
     * timeline_event has no institute_id column, so each row is tied to the
     * institute through the lead it was written on: the response (via its
     * audience), the lead profile, or for other types the student lead profile.
     */
    private static final String NOTES_SQL = """
            SELECT te.actor_id AS user_id,
                   (te.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day,
                   COUNT(*) AS n
            FROM timeline_event te
            WHERE te.category = 'ACTIVITY'
              AND te.actor_id IS NOT NULL
              AND te.created_at >= :fromUtc
              AND te.created_at < :toUtc
              AND (:scopeCsv IS NULL OR te.actor_id = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
              AND (
                    (te.type = 'AUDIENCE_RESPONSE' AND EXISTS (
                        SELECT 1 FROM audience_response ar JOIN audience a ON a.id = ar.audience_id
                        WHERE ar.id = te.type_id AND a.institute_id = :instituteId))
                 OR (te.type = 'USER_LEAD_PROFILE' AND EXISTS (
                        SELECT 1 FROM user_lead_profile ulp
                        WHERE ulp.id = te.type_id AND ulp.institute_id = :instituteId))
                 OR (te.type NOT IN ('AUDIENCE_RESPONSE', 'USER_LEAD_PROFILE')
                     AND te.student_user_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM user_lead_profile ulp
                        WHERE ulp.user_id = te.student_user_id AND ulp.institute_id = :instituteId))
              )
            GROUP BY te.actor_id, 2
            """;

    /**
     * Outbound/inbound dials owned by a counsellor. Window column is
     * COALESCE(start_time, created_at) to match the calling reports (start_time
     * is null until the provider ACKs the call).
     */
    private static final String CALLS_SQL = """
            SELECT tcl.counsellor_user_id AS user_id,
                   (COALESCE(tcl.start_time, tcl.created_at) AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day,
                   COUNT(*) AS n
            FROM telephony_call_log tcl
            WHERE tcl.institute_id = :instituteId
              AND tcl.counsellor_user_id IS NOT NULL
              AND COALESCE(tcl.start_time, tcl.created_at) >= :fromUtc
              AND COALESCE(tcl.start_time, tcl.created_at) < :toUtc
              AND (:scopeCsv IS NULL OR tcl.counsellor_user_id = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
            GROUP BY tcl.counsellor_user_id, 2
            """;

    /**
     * Lead status transitions performed by a counsellor. OPTED_OUT leads are
     * excluded via the audience_response join.
     */
    private static final String STATUS_CHANGES_SQL = """
            SELECT lsh.changed_by_user_id AS user_id,
                   (lsh.changed_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day,
                   COUNT(*) AS n
            FROM lead_status_history lsh
            JOIN audience_response ar ON ar.id = lsh.audience_response_id
            WHERE lsh.institute_id = :instituteId
              AND lsh.changed_by_user_id IS NOT NULL
              AND lsh.changed_at >= :fromUtc
              AND lsh.changed_at < :toUtc
              AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
              AND (:scopeCsv IS NULL OR lsh.changed_by_user_id = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
              AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
            GROUP BY lsh.changed_by_user_id, 2
            """;

    /**
     * Follow-ups scheduled by a counsellor (created_by, windowed on created_at).
     * OPTED_OUT leads excluded via the audience_response join.
     */
    private static final String FOLLOWUPS_CREATED_SQL = """
            SELECT lf.created_by AS user_id,
                   (lf.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day,
                   COUNT(*) AS n
            FROM lead_followup lf
            JOIN audience_response ar ON ar.id = lf.audience_response_id
            WHERE lf.institute_id = :instituteId
              AND lf.created_by IS NOT NULL
              AND lf.created_at >= :fromUtc
              AND lf.created_at < :toUtc
              AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
              AND (:scopeCsv IS NULL OR lf.created_by = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
              AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
            GROUP BY lf.created_by, 2
            """;

    /**
     * Follow-ups closed by a counsellor (closed_by, is_closed = true, windowed
     * on COALESCE(closed_at, updated_at) — closed_at is stamped by the close
     * endpoint, COALESCE to updated_at for legacy rows flipped without a close
     * timestamp). OPTED_OUT leads excluded via the audience_response join.
     */
    private static final String FOLLOWUPS_CLOSED_SQL = """
            SELECT lf.closed_by AS user_id,
                   (COALESCE(lf.closed_at, lf.updated_at) AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day,
                   COUNT(*) AS n
            FROM lead_followup lf
            JOIN audience_response ar ON ar.id = lf.audience_response_id
            WHERE lf.institute_id = :instituteId
              AND lf.is_closed = true
              AND lf.closed_by IS NOT NULL
              AND COALESCE(lf.closed_at, lf.updated_at) >= :fromUtc
              AND COALESCE(lf.closed_at, lf.updated_at) < :toUtc
              AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
              AND (:scopeCsv IS NULL OR lf.closed_by = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
              AND (:audienceId IS NULL OR ar.audience_id = :audienceId)
            GROUP BY lf.closed_by, 2
            """;

    // ─────────────────────────────────────────────────────────────────────
    // activity-timeline
    // ─────────────────────────────────────────────────────────────────────

    public ActivityTimelineReportDTO activityTimeline(String instituteId, String fromDate, String toDate,
                                                      String teamId, String counsellorUserId,
                                                      String audienceId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = leadReportSettingService.get(instituteId);
        ZoneId tz = safeZone(settings);
        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        // audienceId filters the audience_response-linked sources (status changes +
        // follow-ups). Notes (timeline_event) and calls (telephony_call_log) have no
        // campaign link, so they stay campaign-unfiltered by design.
        MapSqlParameterSource params = activityParams(instituteId, fromDate, toDate, tz, scopeCsv, audienceId);

        // Per-actor counts per source, plus a per-day total accumulated across
        // every source as the SQL rows stream in.
        Map<String, ActivityTimelineReportDTO.CounsellorRow> byUser = new HashMap<>();
        Map<String, Long> dailyTotals = new TreeMap<>(); // sorted by yyyy-MM-dd string == chronological

        accumulate(NOTES_SQL, params, byUser, dailyTotals, Field.NOTES);
        accumulate(CALLS_SQL, params, byUser, dailyTotals, Field.CALLS);
        accumulate(STATUS_CHANGES_SQL, params, byUser, dailyTotals, Field.STATUS_CHANGES);
        accumulate(FOLLOWUPS_CREATED_SQL, params, byUser, dailyTotals, Field.FOLLOWUPS_CREATED);
        accumulate(FOLLOWUPS_CLOSED_SQL, params, byUser, dailyTotals, Field.FOLLOWUPS_CLOSED);

        List<ActivityTimelineReportDTO.CounsellorRow> byCounsellor = new ArrayList<>(byUser.values());
        byCounsellor.forEach(r -> r.setTotal(
                r.getNotes() + r.getCalls() + r.getStatusChanges()
                        + r.getFollowupsCreated() + r.getFollowupsClosed()));
        // Most-active counsellors first; userId tie-break keeps the order stable.
        byCounsellor.sort(Comparator
                .comparingLong(ActivityTimelineReportDTO.CounsellorRow::getTotal).reversed()
                .thenComparing(ActivityTimelineReportDTO.CounsellorRow::getUserId));

        Map<String, String> names = fetchNames(
                byCounsellor.stream().map(ActivityTimelineReportDTO.CounsellorRow::getUserId).toList());
        byCounsellor.forEach(r -> r.setName(names.get(r.getUserId())));

        List<ActivityTimelineReportDTO.DayPoint> daily = dailyTotals.entrySet().stream()
                .map(e -> ActivityTimelineReportDTO.DayPoint.builder()
                        .date(e.getKey())
                        .total(e.getValue())
                        .build())
                .toList();

        return ActivityTimelineReportDTO.builder()
                .byCounsellor(byCounsellor)
                .daily(daily)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /** Which per-counsellor counter a source feeds. */
    private enum Field { NOTES, CALLS, STATUS_CHANGES, FOLLOWUPS_CREATED, FOLLOWUPS_CLOSED }

    /**
     * Run one source query and fold its (actor, day, n) rows into the
     * per-counsellor accumulator and the shared per-day total.
     */
    private void accumulate(String sql, MapSqlParameterSource params,
                            Map<String, ActivityTimelineReportDTO.CounsellorRow> byUser,
                            Map<String, Long> dailyTotals, Field field) {
        jdbc.query(sql, params, rs -> {
            String userId = rs.getString("user_id");
            if (userId == null) return; // no counsellor to attribute — drop
            long n = rs.getLong("n");
            ActivityTimelineReportDTO.CounsellorRow row = byUser.computeIfAbsent(userId,
                    id -> ActivityTimelineReportDTO.CounsellorRow.builder().userId(id).build());
            switch (field) {
                case NOTES -> row.setNotes(row.getNotes() + n);
                case CALLS -> row.setCalls(row.getCalls() + n);
                case STATUS_CHANGES -> row.setStatusChanges(row.getStatusChanges() + n);
                case FOLLOWUPS_CREATED -> row.setFollowupsCreated(row.getFollowupsCreated() + n);
                case FOLLOWUPS_CLOSED -> row.setFollowupsClosed(row.getFollowupsClosed() + n);
            }
            String day = rs.getDate("day").toLocalDate().toString();
            dailyTotals.merge(day, n, Long::sum);
        });
    }

    /** Common bind set for the five activity-source queries. */
    private MapSqlParameterSource activityParams(String instituteId, String fromDate, String toDate,
                                                 ZoneId tz, String scopeCsv, String audienceId) {
        Window w = resolveWindow(fromDate, toDate, tz);
        return new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("tz", tz.getId())
                .addValue("scopeCsv", scopeCsv, java.sql.Types.VARCHAR)
                .addValue("audienceId", trimToNull(audienceId), java.sql.Types.VARCHAR)
                .addValue("fromUtc", w.fromUtc(), java.sql.Types.TIMESTAMP)
                .addValue("toUtc", w.toUtc(), java.sql.Types.TIMESTAMP);
    }

    /**
     * fromDate/toDate are institute-TZ calendar dates (yyyy-MM-dd, both
     * inclusive). Convert to UTC instants for the half-open range predicate:
     * from 00:00 → (to + 1 day) 00:00 in the institute zone. Defaults to the
     * trailing 30 days ending today (institute TZ), matching CallingReportService.
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
            log.warn("[ActivityReport] invalid report timezone '{}', falling back to {}",
                    settings != null ? settings.timezone() : null, FALLBACK_ZONE);
            return FALLBACK_ZONE;
        }
    }

    /**
     * Batch display-name hydration via auth-service (cross-DB — never JOIN
     * users in admin_core SQL). One HTTP call; failure leaves names null
     * instead of failing the report.
     */
    private Map<String, String> fetchNames(Collection<String> userIds) {
        List<String> ids = userIds.stream().filter(id -> id != null && !id.isBlank()).distinct().toList();
        if (ids.isEmpty()) return Map.of();
        Map<String, String> out = new HashMap<>();
        try {
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(ids))) {
                if (u != null && u.getId() != null) out.put(u.getId(), u.getFullName());
            }
        } catch (Exception e) {
            log.warn("[ActivityReport] counsellor name hydration failed: {}", e.getMessage());
        }
        return out;
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
}
