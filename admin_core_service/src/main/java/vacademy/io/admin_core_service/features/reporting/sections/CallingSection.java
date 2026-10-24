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
 * Counsellor calling activity — the other half of the admissions picture.
 *
 * {@code AdmissionsSection} says which leads are being neglected; this says whether
 * anyone is picking up the phone, and who.
 *
 * <h3>"Connected" cannot come from answer_time</h3>
 * {@code answer_time} is NULL on every row in production, so a call is counted as
 * connected when {@code status = 'COMPLETED'} AND it lasted a non-zero number of
 * seconds. Of 57,940 completed calls, 384 have zero duration — connected-but-silent
 * is not connected. There is likewise no callbacks-due metric here, because
 * {@code callback_at} is also never populated.
 *
 * <h3>A zero-connection counsellor is usually not an idle one</h3>
 * The stuck queue is not spread evenly. Four counsellors at one institute made
 * 1,866 calls in a week and connected almost none — because 97% of those calls sat
 * in QUEUED. They were dialling; the platform never placed the calls. So a row
 * whose calls are mostly queued says "stuck in queue" instead of a connect rate,
 * because a bare "0 connected" in a report to their manager is an accusation, and
 * it would be pointed at the wrong person.
 *
 * <h3>Calls stuck in the queue</h3>
 * 14,276 of 14,699 QUEUED calls are more than a day old. That is reported as its
 * own figure and worded as "stuck", not as "calls not made", because the data
 * cannot distinguish between the call never being placed and the provider never
 * telling us what happened to it. Either reading is worth an admin's attention, and
 * asserting the wrong one would be worse than describing what we can see.
 *
 * <h3>Counsellor names</h3>
 * The call log stores only {@code counsellor_user_id}, and admin_core has no user
 * table — names live in auth_service. Rather than make a cross-service call per
 * counsellor, the name is recovered from {@code user_lead_profile
 * .assigned_counselor_name}, which resolves 32 of the 39 counsellors seen calling.
 * The rest fall back to a truncated id, which is still enough for an admissions head
 * to know who to ask about.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class CallingSection implements ReportSection {

    private static final int MAX_ROWS = 10;
    /** Queued longer than this and it is not "in flight" any more. */
    private static final int STUCK_HOURS = 24;

    private final JdbcTemplate jdbcTemplate;

    @Override
    public String key() {
        return "calling";
    }

    @Override
    public String title() {
        return "Calling activity";
    }

    @Override
    public String description() {
        return "Outbound and inbound calls in the period, how many connected, and "
                + "which counsellors are actually dialling.";
    }

    @Override
    public Set<String> visibleToRoles() {
        return Set.of("ADMIN");
    }

    @Override
    public Set<ReportContext.ScopeType> supportedScopes() {
        return Set.of(ReportContext.ScopeType.INSTITUTE);
    }

    @Override
    public boolean isAvailableFor(String instituteId) {
        // Telephony is used by only a handful of institutes, so this hides itself
        // for everyone else rather than offering a section that can only be empty.
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM telephony_call_log "
                        + "WHERE institute_id = ? "
                        + "AND created_at > now() - INTERVAL '30 days'",
                Integer.class, instituteId);
        return n != null && n > 0;
    }

    @Override
    public SectionFacts compute(ReportContext ctx) {
        Timestamp from = Timestamp.from(ctx.getWindowStart());
        Timestamp to = Timestamp.from(ctx.getWindowEnd());

        // Argument order follows the '?' order in the SQL TEXT — instituteId sits in
        // the WHERE clause, after every FILTER above it.
        Map<String, Object> s = jdbcTemplate.queryForMap(SUMMARY_SQL,
                STUCK_HOURS, from, to, ctx.getInstituteId());

        int outbound = num(s.get("outbound"));
        int connected = num(s.get("connected"));
        int inbound = num(s.get("inbound"));
        int inboundMissed = num(s.get("inbound_missed"));
        int stuck = num(s.get("stuck_in_queue"));
        long talkSeconds = lng(s.get("talk_seconds"));

        List<SectionFacts.Row> rows = new ArrayList<>();
        for (Map<String, Object> r : jdbcTemplate.queryForList(BY_COUNSELLOR_SQL,
                ctx.getInstituteId(), from, to, MAX_ROWS)) {
            int calls = num(r.get("calls"));
            int conn = num(r.get("connected"));
            int queued = num(r.get("queued"));

            // Say WHY a counsellor shows no connections. Measured on real data, four
            // counsellors made 1,866 calls between them and connected almost none —
            // and 97% of those calls were stuck in QUEUED. They were dialling; the
            // platform never placed the calls. "0 connected" on its own reads as an
            // accusation, and it would have been aimed at the wrong people.
            String connectedCell;
            if (queued * 2 >= calls && conn * 4 < calls) {
                connectedCell = conn + " · " + queued + " stuck in queue";
            } else if (calls > 0) {
                connectedCell = conn + " (" + (int) Math.round(100.0 * conn / calls) + "%)";
            } else {
                connectedCell = String.valueOf(conn);
            }

            rows.add(SectionFacts.Row.builder()
                    .value(str(r.get("counsellor"), "(unknown counsellor)"))
                    .value(String.valueOf(calls))
                    .value(connectedCell)
                    .value(describeSeconds(lng(r.get("talk_seconds"))))
                    .build());
        }

        SectionFacts.SectionFactsBuilder facts = SectionFacts.builder()
                .sectionKey(key())
                .title(title())
                .identifying(false) // counsellors are staff; no lead is named
                .empty(outbound == 0 && inbound == 0)
                .headline("Calls made", String.valueOf(outbound))
                .headline("Connected", outbound > 0
                        ? connected + " (" + (int) Math.round(100.0 * connected / outbound) + "%)"
                        : String.valueOf(connected))
                .headline("Talk time", describeSeconds(talkSeconds))
                .headline("Inbound", inboundMissed > 0
                        ? inbound + " · " + inboundMissed + " missed" : String.valueOf(inbound))
                .tone("Connected", outbound == 0 ? "warn"
                        : connected * 2 >= outbound ? "good" : "warn");

        // Only mentioned when it is actually happening, and worded as "stuck"
        // because the data cannot say whose fault it is.
        if (stuck > 0) {
            facts.headline("Stuck in queue", String.valueOf(stuck))
                    .tone("Stuck in queue", "bad");
        }

        return facts
                .column("Counsellor")
                .column("Calls")
                .column("Connected")
                .column("Talk time")
                .rows(rows)
                .build();
    }

    private static String describeSeconds(long seconds) {
        if (seconds <= 0) return "—";
        long hours = seconds / 3600;
        long mins = (seconds % 3600) / 60;
        if (hours > 0) return hours + "h" + (mins > 0 ? " " + mins + "m" : "");
        return mins > 0 ? mins + " min" : seconds + "s";
    }

    private static int num(Object o) {
        return o == null ? 0 : ((Number) o).intValue();
    }

    private static long lng(Object o) {
        return o == null ? 0L : ((Number) o).longValue();
    }

    private static String str(Object o, String fallback) {
        String v = o == null ? null : String.valueOf(o).trim();
        return (v == null || v.isEmpty()) ? fallback : v;
    }

    /**
     * Params: stuckHours, windowStart, windowEnd, instituteId — in that order,
     * because that is the order the placeholders appear in the TEXT below. The
     * institute filter sits in the inner query's WHERE, after the window flag.
     *
     * The stuck-queue count is deliberately NOT window-bounded: a call queued three
     * weeks ago and never placed is still stuck today, and restricting it to the
     * window would quietly shrink a backlog the institute needs to see.
     */
    private static final String SUMMARY_SQL = """
            SELECT count(*) FILTER (WHERE direction = 'OUTBOUND'
                                      AND in_window) AS outbound,
                   count(*) FILTER (WHERE direction = 'OUTBOUND' AND in_window
                                      AND status = 'COMPLETED'
                                      AND COALESCE(duration_seconds, 0) > 0) AS connected,
                   COALESCE(sum(duration_seconds) FILTER (
                       WHERE in_window AND status = 'COMPLETED'), 0) AS talk_seconds,
                   count(*) FILTER (WHERE direction = 'INBOUND' AND in_window) AS inbound,
                   count(*) FILTER (WHERE direction = 'INBOUND' AND in_window
                                      AND status <> 'COMPLETED') AS inbound_missed,
                   count(*) FILTER (WHERE status = 'QUEUED'
                                      AND created_at
                                          < now() - make_interval(hours => ?)) AS stuck_in_queue
            FROM (
                SELECT direction, status, duration_seconds, created_at,
                       (created_at >= ? AND created_at < ?) AS in_window
                FROM telephony_call_log
                WHERE institute_id = ?
            ) c
            """;

    /**
     * Who dialled, busiest first. Window-bounded, so this table genuinely differs
     * from one day to the next.
     *
     * Params: instituteId, windowStart, windowEnd, limit.
     */
    private static final String BY_COUNSELLOR_SQL = """
            SELECT COALESCE(NULLIF(btrim(nm.name), ''),
                            'id ' || left(c.counsellor_user_id, 8)) AS counsellor,
                   count(*) AS calls,
                   count(*) FILTER (WHERE c.status = 'COMPLETED'
                                      AND COALESCE(c.duration_seconds, 0) > 0) AS connected,
                   count(*) FILTER (WHERE c.status = 'QUEUED') AS queued,
                   COALESCE(sum(c.duration_seconds) FILTER (
                       WHERE c.status = 'COMPLETED'), 0) AS talk_seconds
            FROM telephony_call_log c
            LEFT JOIN LATERAL (
                -- admin_core has no user table; the name is recovered from the lead
                -- profile that the same counsellor is assigned to.
                SELECT p.assigned_counselor_name AS name
                FROM user_lead_profile p
                WHERE p.assigned_counselor_id = c.counsellor_user_id
                  AND p.assigned_counselor_name IS NOT NULL
                LIMIT 1
            ) nm ON TRUE
            WHERE c.institute_id = ?
              AND c.direction = 'OUTBOUND'
              AND c.created_at >= ? AND c.created_at < ?
              AND c.counsellor_user_id IS NOT NULL
            GROUP BY 1
            ORDER BY calls DESC
            LIMIT ?
            """;
}
