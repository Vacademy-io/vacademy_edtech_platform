package vacademy.io.admin_core_service.features.reporting.sections;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.reporting.spi.ReportContext;
import vacademy.io.admin_core_service.features.reporting.spi.ReportSection;
import vacademy.io.admin_core_service.features.reporting.spi.SectionFacts;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * How well attended the live classes were.
 *
 * <h3>Three schema facts this query is built around</h3>
 *
 * <b>1. Occurrences, not sessions.</b> {@code live_session} is the series —
 * {@code start_time} is when the series began, so a weekly class that ran eight
 * times is one row dated eight weeks ago. The real occurrence table is
 * {@code session_schedules} ({@code meeting_date} per sitting), and it is what
 * this section iterates. Driving off {@code live_session} instead misses every
 * sitting in the window; driving off the attendance log instead (the first
 * version of this) silently drops the classes nobody attended — which are the
 * ones an admin most needs to see, and the report sorts worst-first.
 *
 * <b>2. Invitees are not attendance.</b> {@code live_session_participants} is
 * the invite list ({@code source_type} BATCH or USER), not a record of who came.
 * Attendance is {@code live_session_logs} with
 * {@code log_type='ATTENDANCE_RECORDED'}, joined on {@code schedule_id} — which
 * is populated on 100% of those rows and always resolves to a real occurrence.
 * The invite list is still needed, expanded to enrolled learners, because it is
 * the only available denominator: "12 attended" means nothing, "12 of 98" means
 * something.
 *
 * <b>3. Absence is never written.</b> Only {@code status='PRESENT'} rows exist —
 * there is no ABSENT row, so a missing row is ambiguous between "nobody came"
 * and "attendance was never captured". Reporting the second as 0% would accuse a
 * teacher of an empty room on the strength of missing data, and platform-wide it
 * is the COMMON case: of 3,587 occurrences in a recent month, 2,362 had no
 * attendance information at all. {@code last_attendance_sync_at} disambiguates —
 * synced, or has rows, means the figure is real — and this section says "not
 * recorded" rather than inventing a zero.
 *
 * <h3>Why three queries instead of one</h3>
 * The unrecorded classes are counted, then collapsed to one row per class rather
 * than listed per sitting. Listed raw they drown the report: one institute here
 * would contribute 327 consecutive identical "not recorded" lines, and Spark 81.
 * Collapsed, the same fact reads as nine rows — "Demo Day 1, 42 sittings, never
 * recorded" — which is a finding an admin can act on. The separate summary query
 * exists because the row caps would otherwise understate the totals: capped at 60
 * rows, an institute with 327 sittings reports "60 classes held".
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class LiveAttendanceSection implements ReportSection {

    // The runner caps a rendered section at 25 rows. These are sized so the whole
    // table fits inside that budget — 12 ranked + 8 unrecorded + the two notes that
    // declare each cut — because the runner trims from the END, and the unrecorded
    // classes come last. Sized larger, the section's main finding gets cut off.
    /** Attended classes listed individually, worst rate first. */
    private static final int MAX_ATTENDED_ROWS = 12;
    /** Distinct classes named as recording no attendance. */
    private static final int MAX_UNRECORDED_ROWS = 8;
    /** Below this, a class is worth an admin's attention. */
    private static final int POOR_ATTENDANCE_PCT = 50;

    private final JdbcTemplate jdbcTemplate;

    @Override
    public String key() {
        return "live_attendance";
    }

    @Override
    public String title() {
        return "Live class attendance";
    }

    @Override
    public String description() {
        return "Classes held in the period and how many of the invited learners "
                + "joined, worst attended first. Also flags classes where "
                + "attendance is never being recorded.";
    }

    @Override
    public Set<String> visibleToRoles() {
        return Set.of("ADMIN", "TEACHER");
    }

    @Override
    public Set<ReportContext.ScopeType> supportedScopes() {
        // Classes are invited by batch, so a per-batch document is genuinely
        // different. There is no subject dimension on a session, so no SUBJECT.
        return Set.of(ReportContext.ScopeType.INSTITUTE, ReportContext.ScopeType.BATCH);
    }


    @Override
    public boolean isAvailableFor(String instituteId) {
        // Offered when classes are being HELD, not when attendance happens to be
        // captured — "attendance was recorded for 2 of your 83 classes" is a
        // legitimate and useful thing for this section to say.
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM session_schedules ss "
                        + "JOIN live_session ls ON ls.id = ss.session_id "
                        + "WHERE ls.institute_id = ? "
                        + "AND ss.meeting_date > (now() - INTERVAL '30 days')::date",
                Integer.class, instituteId);
        return n != null && n > 0;
    }

    @Override
    public SectionFacts compute(ReportContext ctx) {
        boolean batchScoped = ctx.getScopeType() == ReportContext.ScopeType.BATCH
                && ctx.getScopeId() != null;
        String batchId = batchScoped ? ctx.getScopeId() : null;

        // meeting_date is a DATE, so the window has to be reduced to local dates
        // in the institute's zone — comparing it against a UTC instant shifts the
        // boundary by the offset and moves a whole day's classes into the wrong week.
        LocalDate from = LocalDate.ofInstant(ctx.getWindowStart(), ctx.getZone());
        LocalDate to = LocalDate.ofInstant(ctx.getWindowEnd(), ctx.getZone());
        java.sql.Date sqlFrom = java.sql.Date.valueOf(from);
        java.sql.Date sqlTo = java.sql.Date.valueOf(to);

        // A teacher sees only their own classes. This section names no learner, so
        // the learner-id filter the runner applies downstream cannot scope it —
        // without this a teacher would be emailed every colleague's rates.
        boolean cohortRestricted = ctx.cohortRestricted();
        List<String> cohorts = cohortRestricted ? ctx.getVisibleCohortIds() : List.of();
        if (cohortRestricted && cohorts.isEmpty()) {
            // Mapped to nothing, or the mapping lookup failed and failed closed.
            // Empty is the honest answer; guessing "all classes" is the unsafe one.
            return SectionFacts.builder()
                    .sectionKey(key()).title(title()).identifying(false).empty(true)
                    .build();
        }
        String cohortCsv = String.join(",", cohorts);

        // Headlines come from here — across every occurrence, not just the rendered
        // ones. See SUMMARY_SQL for why that distinction matters.
        Map<String, Object> summary = jdbcTemplate.queryForMap(SUMMARY_SQL,
                ctx.getInstituteId(), sqlFrom, sqlTo,
                batchScoped, batchId,           // which occurrences this document covers
                cohortRestricted, cohortCsv,    // which classes this reader may see
                batchScoped, batchId,           // which learners count in the denominator
                POOR_ATTENDANCE_PCT / 100.0);
        int held = num(summary.get("held"));
        int known = num(summary.get("known"));
        int rated = num(summary.get("rated"));
        int poor = num(summary.get("poor"));
        int sumAttended = num(summary.get("sum_attended"));
        int sumInvited = num(summary.get("sum_invited"));

        List<Map<String, Object>> attended = jdbcTemplate.queryForList(ATTENDED_SQL,
                ctx.getInstituteId(), sqlFrom, sqlTo,
                batchScoped, batchId,
                cohortRestricted, cohortCsv,
                batchScoped, batchId,
                MAX_ATTENDED_ROWS);

        List<SectionFacts.Row> rows = new ArrayList<>();

        for (Map<String, Object> r : attended) {
            int a = num(r.get("attended"));
            int invited = num(r.get("invited"));
            String rate;
            String attendedCell;
            if (invited > 0 && a <= invited) {
                attendedCell = a + " of " + invited;
                rate = (int) Math.round(100.0 * a / invited) + "%";
            } else if (invited > 0) {
                // More attended than were invited — link joins, learners since
                // deactivated, or people from another batch. Measured on real data:
                // 39 of 1,018 classes, the worst rendering as 500%. A rate needs a
                // denominator that actually contains the numerator.
                attendedCell = a + " joined";
                rate = "more than invited";
            } else {
                // Attendance is real but nobody was formally invited — an open or
                // link-joined class. A headcount is honest; a percentage is not.
                attendedCell = String.valueOf(a);
                rate = "no invite list";
            }
            Object avgMin = r.get("avg_min");
            rows.add(SectionFacts.Row.builder()
                    // No subjectId: these rows are classes, not learners, so the
                    // per-recipient learner filter correctly leaves them alone.
                    .value(str(r.get("title"), "(untitled class)"))
                    .value(String.valueOf(r.get("meeting_date")))
                    .value(attendedCell)
                    .value(rate)
                    .value(avgMin == null ? "—" : avgMin + " min")
                    .build());
        }

        // A truncated table must say so. Ending silently at row 40 reads as "these
        // are all the classes with attendance", which is exactly the wrong
        // conclusion when 252 were held and these are the worst 40.
        if (known > rows.size()) {
            rows.add(note((known - rows.size()) + " further classes with attendance "
                    + "recorded, better attended than those listed"));
        }

        // Then the classes recording nothing, one row per class rather than per sitting.
        int unrecorded = held - known;
        if (unrecorded > 0) {
            List<Map<String, Object>> missing = jdbcTemplate.queryForList(UNRECORDED_SQL,
                    ctx.getInstituteId(), sqlFrom, sqlTo, batchScoped, batchId,
                    cohortRestricted, cohortCsv, MAX_UNRECORDED_ROWS);
            int listedSittings = 0;
            for (Map<String, Object> r : missing) {
                int sittings = num(r.get("sittings"));
                listedSittings += sittings;
                rows.add(SectionFacts.Row.builder()
                        .value(str(r.get("title"), "(untitled class)"))
                        .value(sittings == 1 ? "1 sitting" : sittings + " sittings")
                        .value("—")
                        .value("not recorded")
                        .value("—")
                        .build());
            }
            if (unrecorded > listedSittings) {
                rows.add(note((unrecorded - listedSittings)
                        + " further sittings with no attendance recorded"));
            }
        }

        SectionFacts.SectionFactsBuilder facts = SectionFacts.builder()
                .sectionKey(key())
                .title(title())
                .identifying(false) // counts classes, never names a learner
                .empty(held == 0)
                .headline("Classes held", String.valueOf(held))
                .headline("Attendance recorded", known + " of " + held);

        // Only claim an overall rate when there is a real denominator behind it.
        // Headline VALUES render at 22px, so the fallback is a dash rather than a
        // sentence — "Attendance recorded: 2 of 83" above and the per-row "not
        // recorded" already carry the explanation, at a size meant for prose.
        facts.headline("Overall attendance", rated > 0
                ? (int) Math.round(100.0 * sumAttended / sumInvited) + "%"
                : "—");
        if (rated > 0) {
            int overall = (int) Math.round(100.0 * sumAttended / sumInvited);
            facts.headline("Below " + POOR_ATTENDANCE_PCT + "%", poor + " of " + rated)
                    .tone("Overall attendance", overall >= 70 ? "good"
                            : overall >= POOR_ATTENDANCE_PCT ? "warn" : "bad")
                    .tone("Below " + POOR_ATTENDANCE_PCT + "%", poor == 0 ? "good" : "warn");
        }
        // Classes held with attendance never captured is a data problem, not a
        // teaching one, and it is the common case — so it is called out in colour.
        if (held > 0 && known < held) {
            facts.tone("Attendance recorded", known == 0 ? "bad" : "warn");
        }

        return facts
                .column("Class")
                .column("When")
                .column("Attended")
                .column("Rate")
                .column("Avg time")
                .rows(rows)
                .build();
    }

    private static int num(Object o) {
        return o == null ? 0 : ((Number) o).intValue();
    }

    /** A row that carries a remark rather than a class — used to declare a cap. */
    private static SectionFacts.Row note(String text) {
        return SectionFacts.Row.builder()
                .value(text).value("").value("").value("").value("")
                .build();
    }

    private static String str(Object o, String fallback) {
        String s = o == null ? null : String.valueOf(o).trim();
        return (s == null || s.isEmpty()) ? fallback : s;
    }

    /**
     * Occurrences in the window, optionally narrowed to one batch.
     *
     * Written as {@code CAST(? AS boolean)} rather than {@code ?::boolean} — the
     * JDBC driver reads the {@code ::} form's colons as a parameter marker and the
     * statement fails to prepare.
     *
     * Params: instituteId, fromDate, toDate, batchScoped, batchId,
     * cohortRestricted, cohortCsv.
     */
    private static final String OCC_CTE = """
            WITH occ AS (
                SELECT ss.id AS schedule_id, ss.session_id, ss.meeting_date,
                       btrim(ls.title) AS title, ss.last_attendance_sync_at
                FROM session_schedules ss
                JOIN live_session ls ON ls.id = ss.session_id
                WHERE ls.institute_id = ?
                  AND ss.meeting_date >= ? AND ss.meeting_date < ?
                  AND COALESCE(ss.status, '') NOT IN ('DELETED', 'CANCELLED')
                  AND (NOT CAST(? AS boolean) OR EXISTS (
                        SELECT 1 FROM live_session_participants p
                        WHERE p.session_id = ls.id
                          AND p.source_type = 'BATCH' AND p.source_id = ?))
                  -- Recipient's own cohorts. Separate from the scope filter above:
                  -- that narrows what the DOCUMENT is about, this narrows what this
                  -- READER is allowed to be told, and a schedule cannot widen it.
                  AND (NOT CAST(? AS boolean) OR EXISTS (
                        SELECT 1 FROM live_session_participants pc
                        WHERE pc.session_id = ls.id
                          AND pc.source_type = 'BATCH'
                          AND pc.source_id = ANY (string_to_array(?, ','))))
            )
            """;

    /**
     * Attendance and its denominator, per occurrence.
     *
     * The second batch param pair narrows the denominator, so a class invited to
     * batches B and C reports B's learners in B's report rather than both cohorts.
     *
     * Params: batchScoped, batchId.
     */
    private static final String ATT_INV_CTE = """
            , att AS (
                SELECT l.schedule_id,
                       COUNT(DISTINCT l.user_source_id)               AS attended,
                       ROUND(AVG(l.provider_total_duration_minutes))  AS avg_min
                FROM live_session_logs l
                WHERE l.schedule_id IN (SELECT schedule_id FROM occ)
                  AND l.log_type = 'ATTENDANCE_RECORDED'
                  AND l.status = 'PRESENT'
                GROUP BY l.schedule_id
            ),
            inv AS (
                SELECT o.schedule_id, COUNT(DISTINCT x.user_id) AS invited
                FROM occ o
                JOIN live_session_participants p ON p.session_id = o.session_id
                LEFT JOIN LATERAL (
                    SELECT m.user_id
                    FROM student_session_institute_group_mapping m
                    WHERE p.source_type = 'BATCH'
                      AND m.package_session_id = p.source_id
                      AND m.status = 'ACTIVE'
                      AND (NOT CAST(? AS boolean) OR m.package_session_id = ?)
                    UNION ALL
                    SELECT p.source_id WHERE p.source_type = 'USER'
                ) x ON TRUE
                GROUP BY o.schedule_id
            )
            """;

    /**
     * Every headline figure, computed across ALL occurrences in the window.
     *
     * This must not be derived from the rendered rows. Those are capped and sorted
     * worst-first, so averaging them understates the institute systematically —
     * measured on real data, the same week read 31% over the worst 40 classes,
     * 36% over the worst 60, against 252 actually held.
     *
     * Params: OCC_CTE params, ATT_INV_CTE params, poorFraction.
     */
    private static final String SUMMARY_SQL = OCC_CTE + ATT_INV_CTE + """
            SELECT count(*) AS held,
                   count(*) FILTER (WHERE a.schedule_id IS NOT NULL
                                       OR o.last_attendance_sync_at IS NOT NULL) AS known,
                   count(*) FILTER (WHERE a.schedule_id IS NOT NULL
                                      AND COALESCE(i.invited, 0) > 0
                                      AND a.attended <= i.invited) AS rated,
                   COALESCE(sum(a.attended) FILTER (
                       WHERE COALESCE(i.invited, 0) > 0
                         AND a.attended <= i.invited), 0) AS sum_attended,
                   COALESCE(sum(i.invited) FILTER (
                       WHERE a.schedule_id IS NOT NULL
                         AND COALESCE(i.invited, 0) > 0
                         AND a.attended <= i.invited), 0) AS sum_invited,
                   count(*) FILTER (WHERE a.schedule_id IS NOT NULL
                                      AND COALESCE(i.invited, 0) > 0
                                      AND a.attended <= i.invited
                                      AND a.attended::numeric / i.invited < ?) AS poor,
                   -- More people joined than were invited: the invite list is not a
                   -- valid population for this class, so it yields no percentage.
                   count(*) FILTER (WHERE a.schedule_id IS NOT NULL
                                      AND COALESCE(i.invited, 0) > 0
                                      AND a.attended > i.invited) AS over_invited
            FROM occ o
            LEFT JOIN att a ON a.schedule_id = o.schedule_id
            LEFT JOIN inv i ON i.schedule_id = o.schedule_id
            """;

    /**
     * Classes with real attendance, worst rate first — the rendered detail.
     * Params: OCC_CTE params, ATT_INV_CTE params, limit.
     */
    private static final String ATTENDED_SQL = OCC_CTE + ATT_INV_CTE + """
            SELECT o.title, o.meeting_date, a.attended, a.avg_min,
                   COALESCE(i.invited, 0) AS invited
            FROM occ o
            JOIN att a ON a.schedule_id = o.schedule_id
            LEFT JOIN inv i ON i.schedule_id = o.schedule_id
            ORDER BY CASE WHEN COALESCE(i.invited, 0) > 0 THEN 0 ELSE 1 END ASC,
                     CASE WHEN COALESCE(i.invited, 0) > 0
                          THEN a.attended::numeric / i.invited ELSE 0 END ASC,
                     o.meeting_date DESC
            LIMIT ?
            """;

    /**
     * Classes recording no attendance at all, collapsed to one row each.
     * Params: OCC_CTE params, limit.
     */
    private static final String UNRECORDED_SQL = OCC_CTE + """
            SELECT o.title, count(*) AS sittings, max(o.meeting_date) AS latest
            FROM occ o
            WHERE o.last_attendance_sync_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM live_session_logs l
                              WHERE l.schedule_id = o.schedule_id
                                AND l.log_type = 'ATTENDANCE_RECORDED'
                                AND l.status = 'PRESENT')
            GROUP BY o.title
            ORDER BY sittings DESC, latest DESC
            LIMIT ?
            """;
}
