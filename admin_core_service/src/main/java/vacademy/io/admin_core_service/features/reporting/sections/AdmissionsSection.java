package vacademy.io.admin_core_service.features.reporting.sections;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.reporting.spi.ReportContext;
import vacademy.io.admin_core_service.features.reporting.spi.ReportSection;
import vacademy.io.admin_core_service.features.reporting.spi.SectionFacts;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The admissions pipeline: leads arriving, converting, and being dropped.
 *
 * The first section about the BUSINESS rather than the teaching. Everything else in
 * the digest describes learners an institute already has; this one describes the
 * ones it is trying to win.
 *
 * <h3>"Stalled" means abandoned, not unreachable</h3>
 * A first version counted every non-converted lead with no recent activity, which
 * at one institute was 44,037 of 72,683 — a number so large it describes the
 * database rather than a task. Most of it was DNP and NOT_REACHABLE: leads nobody
 * can get hold of, which is a different problem from leads nobody tried. Stalled is
 * therefore restricted to the actively-worked states (LEAD, CALL_BACK, FOLLOWUP)
 * that have gone quiet — someone promised a follow-up and did not make it. Narrowed
 * that way the same institute reports 12,926 stalled out of 13,455 in play, which
 * is still alarming but is now a statement about work, not about data.
 *
 * <h3>Counsellor rows are the point, and only for periodic readers</h3>
 * Per-counsellor backlog is where this becomes actionable — measured on real data,
 * several counsellors held over a thousand leads each with 100% of them stale and
 * zero conversions in a month. But a workload is standing state: identical
 * tomorrow. So it appears in weekly and monthly reports, while a daily reader gets
 * the pipeline movement instead.
 *
 * <h3>Two fields that look useful and are not</h3>
 * {@code first_response_at} is NULL on every row in production, so there is no
 * response-time metric here. And {@code assigned_counselor_id} is set on only 47 of
 * 6,035 converted leads, so conversions cannot be attributed to a counsellor — the
 * counsellor table reports backlog, which is reliable, and shows conversions only
 * as context.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class AdmissionsSection implements ReportSection {

    /** Beyond this with no activity, an actively-worked lead has been dropped. */
    private static final int STALE_DAYS = 7;
    private static final int MAX_STATUS_ROWS = 8;
    private static final int MAX_COUNSELLOR_ROWS = 8;

    /** The states in which somebody is supposed to be working the lead. */
    private static final String IN_PLAY = "('LEAD', 'CALL_BACK', 'FOLLOWUP')";

    private final JdbcTemplate jdbcTemplate;

    @Override
    public String key() {
        return "admissions";
    }

    @Override
    public String title() {
        return "Leads & admissions";
    }

    @Override
    public String description() {
        return "Leads arriving and converting in the period, how many are sitting "
                + "untouched, and which counsellors are carrying a stalled pipeline.";
    }

    @Override
    public Set<String> visibleToRoles() {
        // Sales pipeline is an owner and admissions-manager concern, not a teaching one.
        return Set.of("ADMIN");
    }

    @Override
    public Set<ReportContext.ScopeType> supportedScopes() {
        // A lead has no batch: they have not enrolled in anything yet.
        return Set.of(ReportContext.ScopeType.INSTITUTE);
    }

    @Override
    public boolean isAvailableFor(String instituteId) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM user_lead_profile "
                        + "WHERE institute_id = ? "
                        + "AND created_at > now() - INTERVAL '90 days'",
                Integer.class, instituteId);
        return n != null && n > 0;
    }

    @Override
    public SectionFacts compute(ReportContext ctx) {
        Timestamp from = Timestamp.from(ctx.getWindowStart());
        Timestamp to = Timestamp.from(ctx.getWindowEnd());

        // Argument order follows the ORDER OF '?' IN THE SQL TEXT, not any logical
        // grouping — instituteId sits in the WHERE clause, which comes last.
        Map<String, Object> s = jdbcTemplate.queryForMap(SUMMARY_SQL,
                from, to, from, to, STALE_DAYS, ctx.getInstituteId());

        int newLeads = num(s.get("new_leads"));
        int converted = num(s.get("converted"));
        int inPlay = num(s.get("in_play"));
        int stalled = num(s.get("stalled"));
        int unassigned = num(s.get("unassigned"));
        int unreachable = num(s.get("unreachable"));

        List<SectionFacts.Row> rows = new ArrayList<>();

        // Pipeline movement — the part that differs from yesterday.
        for (Map<String, Object> r : jdbcTemplate.queryForList(BY_STATUS_SQL,
                from, to, STALE_DAYS, ctx.getInstituteId(), from, to, MAX_STATUS_ROWS)) {
            int stale = num(r.get("stalled"));
            rows.add(SectionFacts.Row.builder()
                    .value(str(r.get("conversion_status"), "(no status)"))
                    .value(String.valueOf(num(r.get("new_in_window"))))
                    .value(stale == 0 ? "—" : String.valueOf(stale))
                    .value(String.valueOf(num(r.get("total"))))
                    .build());
        }

        // Workload is standing state, so it goes to readers who are not hearing from
        // us every morning. A daily reader would see the same names indefinitely.
        if (!ctx.isDailyCadence()) {
            List<Map<String, Object>> counsellors = jdbcTemplate.queryForList(BY_COUNSELLOR_SQL,
                    STALE_DAYS, from, to, ctx.getInstituteId(), MAX_COUNSELLOR_ROWS);
            for (Map<String, Object> r : counsellors) {
                int held = num(r.get("in_play"));
                int stale = num(r.get("stalled"));
                rows.add(SectionFacts.Row.builder()
                        .value(str(r.get("counsellor"), "(unnamed counsellor)"))
                        .value(String.valueOf(held))
                        .value(held > 0
                                ? stale + " (" + (int) Math.round(100.0 * stale / held) + "%)"
                                : String.valueOf(stale))
                        .value(String.valueOf(num(r.get("converted"))))
                        .build());
            }
        }

        SectionFacts.SectionFactsBuilder facts = SectionFacts.builder()
                .sectionKey(key())
                .title(title())
                .identifying(false) // counsellors are staff; no lead is named
                .empty(newLeads == 0 && converted == 0)
                .headline("New leads", String.valueOf(newLeads))
                .headline("Converted", String.valueOf(converted))
                .headline("Being worked", String.valueOf(inPlay))
                .headline("Untouched " + STALE_DAYS + "+ days", inPlay > 0
                        ? stalled + " of " + inPlay : String.valueOf(stalled))
                .headline("Nobody assigned", String.valueOf(unassigned))
                // Unreachable is a separate problem from neglected, and conflating
                // them is what made the first version of this unusable.
                .headline("Unreachable", String.valueOf(unreachable))
                .tone("Untouched " + STALE_DAYS + "+ days",
                        inPlay == 0 || stalled == 0 ? "good"
                                : stalled * 2 >= inPlay ? "bad" : "warn")
                .tone("Nobody assigned", unassigned == 0 ? "good" : "warn")
                .column(ctx.isDailyCadence() ? "Status" : "Status / counsellor")
                .column("New")
                .column("Untouched")
                .column("Total");

        return facts.rows(rows).build();
    }

    private static int num(Object o) {
        return o == null ? 0 : ((Number) o).intValue();
    }

    private static String str(Object o, String fallback) {
        String v = o == null ? null : String.valueOf(o).trim();
        return (v == null || v.isEmpty()) ? fallback : v;
    }

    /**
     * Params: instituteId, windowStart, windowEnd, windowStart, windowEnd, staleDays.
     *
     * {@code last_activity_at} falls back to {@code created_at}: a lead that has
     * never been touched has no activity timestamp, and treating that as "active"
     * would hide exactly the leads nobody has worked.
     */
    private static final String SUMMARY_SQL = """
            SELECT count(*) FILTER (WHERE created_at >= ? AND created_at < ?) AS new_leads,
                   count(*) FILTER (WHERE converted_at >= ? AND converted_at < ?) AS converted,
                   count(*) FILTER (WHERE conversion_status IN """ + IN_PLAY + """
                       ) AS in_play,
                   count(*) FILTER (WHERE conversion_status IN """ + IN_PLAY + """
                                      AND COALESCE(last_activity_at, created_at)
                                          < now() - make_interval(days => ?)) AS stalled,
                   count(*) FILTER (WHERE conversion_status = 'LEAD'
                                      AND assigned_counselor_id IS NULL) AS unassigned,
                   count(*) FILTER (WHERE conversion_status
                                          IN ('DNP', 'NOT_REACHABLE')) AS unreachable
            FROM user_lead_profile
            WHERE institute_id = ?
            """;

    /**
     * Pipeline by status, most new first — this is the part that moves day to day.
     *
     * Params: instituteId, windowStart, windowEnd, windowStart, windowEnd, staleDays, limit.
     */
    private static final String BY_STATUS_SQL = """
            SELECT conversion_status,
                   count(*) FILTER (WHERE created_at >= ? AND created_at < ?) AS new_in_window,
                   count(*) FILTER (WHERE conversion_status IN """ + IN_PLAY + """
                                      AND COALESCE(last_activity_at, created_at)
                                          < now() - make_interval(days => ?)) AS stalled,
                   count(*) AS total
            FROM user_lead_profile
            WHERE institute_id = ?
            GROUP BY conversion_status
            ORDER BY count(*) FILTER (WHERE created_at >= ? AND created_at < ?) DESC,
                     count(*) DESC
            LIMIT ?
            """;

    /**
     * Counsellors carrying the largest stalled backlog.
     *
     * Conversions are shown for context only, NOT as a performance measure: only 47
     * of 6,035 converted leads in production carry a counsellor id, so a zero here
     * means the attribution is missing far more often than it means nobody sold
     * anything.
     *
     * Params: instituteId, staleDays, windowStart, windowEnd, limit.
     */
    private static final String BY_COUNSELLOR_SQL = """
            SELECT COALESCE(NULLIF(btrim(assigned_counselor_name), ''),
                            '(unnamed counsellor)') AS counsellor,
                   count(*) FILTER (WHERE conversion_status IN """ + IN_PLAY + """
                       ) AS in_play,
                   count(*) FILTER (WHERE conversion_status IN """ + IN_PLAY + """
                                      AND COALESCE(last_activity_at, created_at)
                                          < now() - make_interval(days => ?)) AS stalled,
                   count(*) FILTER (WHERE converted_at >= ? AND converted_at < ?) AS converted
            FROM user_lead_profile
            WHERE institute_id = ?
              AND assigned_counselor_id IS NOT NULL
            GROUP BY 1
            HAVING count(*) FILTER (WHERE conversion_status IN """ + IN_PLAY + """
                       ) > 0
            ORDER BY stalled DESC, in_play DESC
            LIMIT ?
            """;
}
