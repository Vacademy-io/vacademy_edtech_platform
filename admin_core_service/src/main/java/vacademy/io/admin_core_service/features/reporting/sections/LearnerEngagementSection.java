package vacademy.io.admin_core_service.features.reporting.sections;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.reporting.spi.ReportContext;
import vacademy.io.admin_core_service.features.reporting.spi.ReportSection;
import vacademy.io.admin_core_service.features.reporting.spi.SectionFacts;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * How much learning actually happened, and in which cohorts.
 *
 * Deliberately a companion to {@code InactivitySection} rather than a repeat of
 * it: that one names individual learners who went quiet, this one stays at cohort
 * level and answers "is this batch studying at all".
 *
 * <h3>Why engagement time is clamped per row</h3>
 * {@code activity_log.engaged_ms} is wall-clock time attributed to one activity,
 * and it includes tabs left open — the maximum observed is exactly 86,400,000 ms,
 * which is 24 hours to the millisecond. The tail is not a rounding error: in a
 * recent month, 135 rows of 16,329 (0.8%) carried 2,270 of the 4,837 total hours.
 * Reporting the raw sum would roughly DOUBLE every institute's learning time and
 * the number would be indefensible the moment anyone checked it. Each activity is
 * therefore capped at {@link #MAX_MS_PER_ACTIVITY} before summing.
 *
 * <h3>Why there is no per-batch hours column</h3>
 * 16% of learners are enrolled in more than one batch, and an activity row is not
 * attributable to a specific one. Summing hours per batch would therefore count
 * the same study time in several batches and the column would not add up to the
 * institute total printed above it. Participation (active of enrolled) has no such
 * problem — a learner either studied or did not, in every batch they belong to —
 * so the rows report participation, and the total hours stay a headline where they
 * are computed once per learner.
 *
 * <h3>Why dormant batches are listed separately</h3>
 * Ranking every batch worst-first fills the table with dead demo cohorts: at one
 * institute the twelve worst were all 0%, and the batches where learning was
 * genuinely thin never appeared. Batches with a pulse are ranked; batches with no
 * activity at all are listed largest-first and counted, because "175 enrolled,
 * nobody studying" is a different problem from "9 of 234 studying".
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class LearnerEngagementSection implements ReportSection {

    /** Ceiling for one activity row: 2 hours. See the class note. */
    private static final long MAX_MS_PER_ACTIVITY = 2L * 60 * 60 * 1000;
    /** Batches with a pulse, ranked worst-first. */
    private static final int MAX_ACTIVE_ROWS = 10;
    /** Dormant batches, largest first. */
    private static final int MAX_DORMANT_ROWS = 6;
    /**
     * Below this many active learners a median is not a cohort statistic, it is
     * one person's afternoon wearing a statistic's clothes.
     */
    private static final int MIN_ACTIVE_FOR_MEDIAN = 5;

    private final JdbcTemplate jdbcTemplate;

    @Override
    public String key() {
        return "learner_engagement";
    }

    @Override
    public String title() {
        return "Learner engagement";
    }

    @Override
    public String description() {
        return "Learners who studied in the period against the period before, "
                + "total learning time, and which cohorts are engaged or dormant.";
    }

    @Override
    public Set<String> visibleToRoles() {
        return Set.of("ADMIN", "TEACHER");
    }

    @Override
    public Set<ReportContext.ScopeType> supportedScopes() {
        return Set.of(ReportContext.ScopeType.INSTITUTE, ReportContext.ScopeType.BATCH);
    }


    @Override
    public boolean isAvailableFor(String instituteId) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM activity_log a "
                        + "WHERE a.created_at > now() - INTERVAL '30 days' "
                        + "AND EXISTS (SELECT 1 FROM student_session_institute_group_mapping m "
                        + "            WHERE m.user_id = a.user_id AND m.institute_id = ? "
                        + "              AND m.status = 'ACTIVE')",
                Integer.class, instituteId);
        return n != null && n > 0;
    }

    @Override
    public SectionFacts compute(ReportContext ctx) {
        boolean batchScoped = ctx.getScopeType() == ReportContext.ScopeType.BATCH
                && ctx.getScopeId() != null;
        String batchId = batchScoped ? ctx.getScopeId() : null;

        boolean cohortRestricted = ctx.cohortRestricted();
        List<String> cohorts = cohortRestricted ? ctx.getVisibleCohortIds() : List.of();
        if (cohortRestricted && cohorts.isEmpty()) {
            return SectionFacts.builder()
                    .sectionKey(key()).title(title()).identifying(false).empty(true)
                    .build();
        }
        String cohortCsv = String.join(",", cohorts);

        Timestamp from = Timestamp.from(ctx.getWindowStart());
        Timestamp to = Timestamp.from(ctx.getWindowEnd());
        // Same-length window immediately before, so the comparison is like for like.
        long span = ctx.getWindowEnd().toEpochMilli() - ctx.getWindowStart().toEpochMilli();
        Timestamp prevFrom = Timestamp.from(
                Instant.ofEpochMilli(ctx.getWindowStart().toEpochMilli() - span));

        Object[] scope = {ctx.getInstituteId(), batchScoped, batchId, cohortRestricted, cohortCsv};

        Map<String, Object> s = jdbcTemplate.queryForMap(SUMMARY_SQL,
                concat(scope, MAX_MS_PER_ACTIVITY, from, to, MAX_MS_PER_ACTIVITY, prevFrom, from));

        int enrolled = num(s.get("enrolled_learners"));
        int active = num(s.get("active_now"));
        int prev = num(s.get("active_prev"));
        int batchesTotal = num(s.get("batches_total"));
        int batchesActive = num(s.get("batches_active"));
        Object hours = s.get("hours_clamped");
        Object medianMin = s.get("median_min");

        List<SectionFacts.Row> rows = new ArrayList<>();

        // Daily readers get where learning actually happened; periodic readers get
        // the ranking of who is falling behind.
        boolean daily = ctx.isDailyCadence();
        for (Map<String, Object> r : jdbcTemplate.queryForList(BATCH_SQL,
                concat(scope, MAX_MS_PER_ACTIVITY, from, to,
                        true, daily, !daily, MAX_ACTIVE_ROWS))) {
            rows.add(batchRow(r, true));
        }

        // A dormant-batch list is the same list every morning, so it belongs in a
        // periodic report, not a daily one.
        int dormant = daily ? 0 : batchesTotal - batchesActive;
        if (dormant > 0) {
            List<Map<String, Object>> quiet = jdbcTemplate.queryForList(BATCH_SQL,
                    concat(scope, MAX_MS_PER_ACTIVITY, from, to,
                            false, false, false, MAX_DORMANT_ROWS));
            for (Map<String, Object> r : quiet) {
                rows.add(batchRow(r, false));
            }
            if (dormant > quiet.size()) {
                rows.add(SectionFacts.Row.builder()
                        .value((dormant - quiet.size()) + " further batches with no activity")
                        .value("").value("").value("")
                        .build());
            }
        }

        return SectionFacts.builder()
                .sectionKey(key())
                .title(title())
                .identifying(false) // cohort level: counts batches, names no learner
                .empty(active == 0 && prev == 0)
                .headline("Learners who studied", active + " of " + enrolled)
                .headline("vs previous period", describeDelta(active, prev))
                .headline("Learning time", hours == null ? "—" : fmtHours(hours))
                .headline("Median per learner", medianMin == null
                        ? "—" : describeMinutes(((Number) medianMin).intValue()))
                .headline("Batches with activity", batchesActive + " of " + batchesTotal)
                .column("Batch")
                .column("Enrolled")
                .column("Studied")
                .column("Median time")
                .rows(rows)
                .build();
    }

    private SectionFacts.Row batchRow(Map<String, Object> r, boolean hasActivity) {
        int enrolled = num(r.get("enrolled"));
        int active = num(r.get("active"));
        Object median = r.get("median_min");

        String studied = hasActivity && enrolled > 0
                ? active + " (" + (int) Math.round(100.0 * active / enrolled) + "%)"
                : "none";
        // A median over one or two people is that person's time, not the cohort's.
        String medianCell = (hasActivity && active >= MIN_ACTIVE_FOR_MEDIAN && median != null)
                ? describeMinutes(((Number) median).intValue())
                : "—";

        return SectionFacts.Row.builder()
                .value(str(r.get("batch"), "(unnamed batch)"))
                .value(String.valueOf(enrolled))
                .value(studied)
                .value(medianCell)
                .build();
    }

    private static Object[] concat(Object[] head, Object... tail) {
        Object[] out = new Object[head.length + tail.length];
        System.arraycopy(head, 0, out, 0, head.length);
        System.arraycopy(tail, 0, out, head.length, tail.length);
        return out;
    }

    private static String describeDelta(int now, int before) {
        if (before <= 0) return now > 0 ? "first activity" : "—";
        long pct = Math.round(100.0 * (now - before) / before);
        if (pct == 0) return "unchanged";
        return (pct > 0 ? "+" : "") + pct + "%";
    }

    private static String describeMinutes(int minutes) {
        if (minutes < 60) return minutes + " min";
        int h = minutes / 60, m = minutes % 60;
        return m == 0 ? h + "h" : h + "h " + m + "m";
    }

    private static String fmtHours(Object hours) {
        double h = ((Number) hours).doubleValue();
        if (h < 1) return Math.round(h * 60) + " min";
        return h >= 100 ? String.format("%,.0f h", h) : String.format("%.1f h", h);
    }

    private static int num(Object o) {
        return o == null ? 0 : ((Number) o).intValue();
    }

    private static String str(Object o, String fallback) {
        String v = o == null ? null : String.valueOf(o).trim();
        return (v == null || v.isEmpty()) ? fallback : v;
    }

    /**
     * Enrolled learners for this institute, optionally narrowed to one batch and
     * to the reader's own cohorts.
     *
     * Params: instituteId, batchScoped, batchId, cohortRestricted, cohortCsv.
     */
    private static final String ENROLLED_CTE = """
            WITH enrolled AS (
                SELECT DISTINCT m.package_session_id AS ps_id, m.user_id
                FROM student_session_institute_group_mapping m
                WHERE m.institute_id = ?
                  AND m.status = 'ACTIVE'
                  AND (NOT CAST(? AS boolean) OR m.package_session_id = ?)
                  AND (NOT CAST(? AS boolean)
                       OR m.package_session_id = ANY (string_to_array(?, ',')))
            ),
            learners AS (SELECT DISTINCT user_id FROM enrolled)
            """;

    /**
     * Institute-level figures. Time is summed per LEARNER, so a learner enrolled
     * in several batches contributes once — see the class note on why the per-batch
     * rows deliberately carry no hours column.
     *
     * Params: ENROLLED_CTE params, clampMs, windowStart, windowEnd,
     *         clampMs, prevStart, windowStart.
     */
    private static final String SUMMARY_SQL = ENROLLED_CTE + """
            , cur AS (
                SELECT a.user_id,
                       sum(LEAST(GREATEST(COALESCE(a.engaged_ms, 0), 0), ?)) AS ms
                FROM activity_log a
                JOIN learners l ON l.user_id = a.user_id
                WHERE a.created_at >= ? AND a.created_at < ?
                GROUP BY a.user_id
                HAVING sum(LEAST(GREATEST(COALESCE(a.engaged_ms, 0), 0), ?)) > 0
            ),
            prv AS (
                SELECT DISTINCT a.user_id
                FROM activity_log a
                JOIN learners l ON l.user_id = a.user_id
                WHERE a.created_at >= ? AND a.created_at < ?
                  AND COALESCE(a.engaged_ms, 0) > 0
            )
            SELECT (SELECT count(*) FROM learners)              AS enrolled_learners,
                   (SELECT count(*) FROM cur)                   AS active_now,
                   (SELECT count(*) FROM prv)                   AS active_prev,
                   (SELECT round(sum(ms) / 3600000.0, 1) FROM cur) AS hours_clamped,
                   (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)
                                 / 60000.0) FROM cur)           AS median_min,
                   (SELECT count(DISTINCT ps_id) FROM enrolled) AS batches_total,
                   (SELECT count(DISTINCT e.ps_id) FROM enrolled e
                      JOIN cur c ON c.user_id = e.user_id)      AS batches_active
            """;

    /**
     * Per-batch participation. One query serves both halves of the table: with
     * {@code wantActive} true it returns batches that have a pulse, ranked
     * worst-first; false returns the dormant ones, largest first. The flag appears
     * twice because it drives both the filter and the ordering — for dormant
     * batches the rate term collapses to a constant, leaving size as the order.
     *
     * Params: ENROLLED_CTE params, clampMs, windowStart, windowEnd,
     *         wantActive, byActivity, wantRateOrder, limit.
     */
    private static final String BATCH_SQL = ENROLLED_CTE + """
            , per_learner AS (
                SELECT a.user_id,
                       sum(LEAST(GREATEST(COALESCE(a.engaged_ms, 0), 0), ?)) AS ms
                FROM activity_log a
                JOIN learners l ON l.user_id = a.user_id
                WHERE a.created_at >= ? AND a.created_at < ?
                GROUP BY a.user_id
                HAVING sum(COALESCE(a.engaged_ms, 0)) > 0
            ),
            by_batch AS (
                SELECT ps.id,
                       lbl.label AS batch,
                       count(DISTINCT e.user_id)  AS enrolled,
                       count(DISTINCT pl.user_id) AS active,
                       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY pl.ms)
                             / 60000.0) AS median_min
                FROM enrolled e
                JOIN package_session ps ON ps.id = e.ps_id
                LEFT JOIN package p ON p.id = ps.package_id
                LEFT JOIN level l ON l.id = ps.level_id
                LEFT JOIN session sn ON sn.id = ps.session_id
                -- package_session.name is null across every institute checked, so a
                -- bare package name repeats: one institute had four distinct batches
                -- all rendering as "Premium Pro Group 2". Level and academic year
                -- are what separate them, appended only when they are not already
                -- part of the name — otherwise batches that DO name their class read
                -- as "Summer Sprint - Class 6 · Class 6 · 2026-27".
                LEFT JOIN LATERAL (
                    SELECT CASE
                             WHEN sn.session_name IS NULL OR btrim(sn.session_name) = ''
                                  OR wl ILIKE '%' || sn.session_name || '%'
                             THEN wl ELSE wl || ' · ' || sn.session_name END AS label
                    FROM (
                        SELECT CASE
                                 WHEN l.level_name IS NULL OR btrim(l.level_name) = ''
                                      OR b ILIKE '%' || l.level_name || '%'
                                 THEN b ELSE b || ' · ' || l.level_name END AS wl
                        FROM (SELECT COALESCE(NULLIF(btrim(ps.name), ''), p.package_name,
                                              '(unnamed batch)') AS b) base
                    ) withLevel
                ) lbl ON TRUE
                LEFT JOIN per_learner pl ON pl.user_id = e.user_id
                GROUP BY ps.id, lbl.label
            )
            SELECT batch, enrolled, active, median_min
            FROM by_batch
            WHERE enrolled > 0
              AND (CASE WHEN CAST(? AS boolean) THEN active > 0 ELSE active = 0 END)
            -- Two orderings, because the question differs by cadence. A daily reader
            -- wants "where did learning happen today", so the busiest cohorts lead.
            -- A weekly or monthly reader wants "which cohorts are failing", so the
            -- worst rate leads. Ranking worst-first every day showed the same dead
            -- demo batches repeatedly: measured across two consecutive daily reports,
            -- 6 of 10 rows were identical.
            ORDER BY CASE WHEN CAST(? AS boolean) THEN active ELSE 0 END DESC,
                     CASE WHEN CAST(? AS boolean)
                          THEN active::numeric / enrolled ELSE 0 END ASC,
                     enrolled DESC
            LIMIT ?
            """;
}
