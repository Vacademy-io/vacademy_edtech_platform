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
 * Doubts and queries learners raised, and whether anyone answered them.
 *
 * <h3>Why the backlog is not window-bounded</h3>
 * Every other section reports on a period. This one reports the OPEN QUEUE as it
 * stands now, and uses the window only for the flow figures (raised, resolved,
 * time-to-resolve). Restricting the queue to the window would make the section
 * useless exactly where it matters most: the pilot institute has 54 open doubts,
 * 39 of them unanswered for more than three days, and raised precisely 0 in the
 * last month. A window-bounded version emails them "nothing to report" while a
 * student's question from 404 days ago sits unanswered.
 *
 * <h3>How "answered" is decided</h3>
 * Replies are child rows ({@code parent_id}), so a root doubt with no live child
 * has had no response at all — a stronger and more useful signal than {@code
 * status}, which stays ACTIVE whether a teacher replied once or never opened it.
 * The two are reported separately for that reason.
 *
 * <h3>Quoting learner text safely</h3>
 * The quote is the point — "39 open doubts" prompts nothing, whereas "Sir what is
 * iteration can you explain me once again sir — 110 days, no reply" prompts
 * someone to go and answer it. But {@code html_text} is learner-authored HTML
 * ranging from 52 bytes to 998 KB, because images arrive inline as base64 data
 * URIs. So the snippet is cut to 4 KB, stripped of complete tags AND of a
 * trailing unterminated one (otherwise a 998 KB {@code <img src="data:...>} whose
 * closing bracket sits beyond the cut leaks raw base64 into the email), stripped
 * of any remaining 45+ character unbroken run, entity-decoded once so the
 * renderer's escaping does not double up, and finally capped for display.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class DoubtsSection implements ReportSection {

    /** Oldest-unanswered first. Sized to fit the runner's 25-row display budget. */
    private static final int MAX_ROWS = 12;
    /** Waiting longer than this is the thing worth surfacing. */
    private static final int STALE_DAYS = 3;

    private final JdbcTemplate jdbcTemplate;

    @Override
    public String key() {
        return "doubts";
    }

    @Override
    public String title() {
        return "Doubts & queries";
    }

    @Override
    public String description() {
        return "The open doubt queue — who is waiting, how long, and whether "
                + "anyone has replied — plus what was raised and resolved in the period.";
    }

    @Override
    public Set<String> visibleToRoles() {
        return Set.of("ADMIN", "TEACHER");
    }

    @Override
    public boolean identifying() {
        // Names the learner and quotes their question.
        return true;
    }

    @Override
    public Set<ReportContext.ScopeType> supportedScopes() {
        // A doubt carries package_session_id, so a per-batch document is real.
        return Set.of(ReportContext.ScopeType.INSTITUTE, ReportContext.ScopeType.BATCH);
    }


    @Override
    public boolean isAvailableFor(String instituteId) {
        // Open-now OR recent activity. Availability must not be window-bounded for
        // the same reason the section is not: an institute whose entire doubt
        // history is old still has a backlog worth reporting.
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM doubts d "
                        + "WHERE d.institute_id = ? AND d.parent_id IS NULL "
                        + "AND d.status <> 'DELETED' "
                        + "AND (d.status = 'ACTIVE' "
                        + "     OR d.raised_time > now() - INTERVAL '90 days')",
                Integer.class, instituteId);
        return n != null && n > 0;
    }

    @Override
    public SectionFacts compute(ReportContext ctx) {
        boolean batchScoped = ctx.getScopeType() == ReportContext.ScopeType.BATCH
                && ctx.getScopeId() != null;
        String batchId = batchScoped ? ctx.getScopeId() : null;

        // A teacher sees only their own cohorts' doubts. Applied in SQL so the
        // headline counts are scoped too, not just the named rows below.
        boolean cohortRestricted = ctx.cohortRestricted();
        List<String> cohorts = cohortRestricted ? ctx.getVisibleCohortIds() : List.of();
        if (cohortRestricted && cohorts.isEmpty()) {
            return SectionFacts.builder()
                    .sectionKey(key()).title(title()).identifying(true).empty(true)
                    .build();
        }
        String cohortCsv = String.join(",", cohorts);

        Timestamp from = Timestamp.from(ctx.getWindowStart());
        Timestamp to = Timestamp.from(ctx.getWindowEnd());

        Map<String, Object> s = jdbcTemplate.queryForMap(SUMMARY_SQL,
                ctx.getInstituteId(), batchScoped, batchId, cohortRestricted, cohortCsv,
                STALE_DAYS, from, to, from, to, from, to,
                from, to, from, to, from, to);

        int openNow = num(s.get("open_now"));
        int unanswered = num(s.get("unanswered"));
        int stale = num(s.get("stale"));
        int raised = num(s.get("raised_in_window"));
        int resolved = num(s.get("resolved_in_window"));
        Object medianH = s.get("median_h");
        Object medianFirst = s.get("median_first_reply_h");
        int answeredInWindow = num(s.get("answered_in_window"));
        int withinDay = num(s.get("replied_within_day"));

        // A daily reader gets what changed; a weekly or monthly reader gets how
        // things stand. Reporting the standing backlog every day shows the same
        // ancient doubts forever and buries the ones that arrived today.
        boolean incremental = ctx.isDailyCadence() && ctx.hasPreviousRun();
        Timestamp since = incremental ? Timestamp.from(ctx.getPreviousRunAt()) : null;

        List<Map<String, Object>> open = incremental
                ? jdbcTemplate.queryForList(NEW_SINCE_SQL,
                        ctx.getInstituteId(), batchScoped, batchId, cohortRestricted, cohortCsv,
                        since, since, STALE_DAYS, since, STALE_DAYS, MAX_ROWS)
                : jdbcTemplate.queryForList(OPEN_SQL,
                        ctx.getInstituteId(), batchScoped, batchId, cohortRestricted, cohortCsv,
                        MAX_ROWS);

        List<SectionFacts.Row> rows = new ArrayList<>();
        int named = 0;
        for (Map<String, Object> r : open) {
            String userId = (String) r.get("user_id");
            // Teacher recipients only ever see their own learners. Enforced here,
            // server-side, so a mis-configured schedule cannot widen it. A guest
            // query has no user id and so cannot be attributed to a cohort — for a
            // restricted reader that means it is withheld, not shown.
            if (ctx.namingRestricted()
                    && (userId == null || !ctx.getVisibleLearnerIds().contains(userId))) {
                continue;
            }
            named++;

            int days = num(r.get("days_waiting"));
            boolean answered = Boolean.TRUE.equals(r.get("answered"));
            String waiting = (days == 1 ? "1 day" : days + " days")
                    + (answered ? " · replied" : " · no reply");
            String snippet = str(r.get("snippet"), "");

            rows.add(SectionFacts.Row.builder()
                    .subjectId(userId)
                    .value(str(r.get("asker"), "(unnamed learner)"))
                    .value(str(r.get("type"), "DOUBT"))
                    .value(waiting)
                    // Six rows platform-wide have no text at all — an attachment
                    // with no question typed alongside it.
                    .value(snippet.isEmpty() ? "(no text — attachment only)" : snippet)
                    .build());
        }

        if (!incremental && openNow > named && named > 0) {
            rows.add(SectionFacts.Row.builder()
                    .value((openNow - named) + " more open, longest-waiting shown first")
                    .value("").value("").value("")
                    .build());
        } else if (incremental && openNow > 0) {
            // Standing backlog still stated, so a quiet day does not read as an
            // empty queue — but it is one line, not twelve repeated rows.
            rows.add(SectionFacts.Row.builder()
                    .value(openNow + " still open in total, " + stale
                            + " waiting more than " + STALE_DAYS + " days")
                    .value("").value("").value("")
                    .build());
        }

        SectionFacts.SectionFactsBuilder facts = SectionFacts.builder()
                .sectionKey(key())
                .title(title())
                .identifying(true)
                // On a daily cadence an unchanged backlog is not news. Combined with
                // skipIfNoData this is what stops a subscriber receiving the same
                // report every morning.
                .empty(incremental
                        ? named == 0 && raised == 0 && resolved == 0
                        : openNow == 0 && raised == 0 && resolved == 0)
                // What MOVED in the period, first. Every one of these changes daily;
                // the standing counts below do not, which is why they are held back
                // for readers who hear from us less often.
                .headline("Raised", String.valueOf(raised))
                .headline("Answered", String.valueOf(answeredInWindow))
                .headline("Median first reply", medianFirst == null
                        ? "—" : describeHours(((Number) medianFirst).intValue()))
                .headline("Answered within a day", answeredInWindow == 0
                        ? "—" : withinDay + " of " + answeredInWindow)
                // One standing number even on a daily report, because a growing
                // backlog is the thing a daily reader must not be allowed to forget.
                .headline("Waiting " + STALE_DAYS + "+ days", String.valueOf(stale))
                // Colour asserts something, so only where the data is unambiguous:
                // a doubt nobody has answered in three days is simply bad.
                .tone("Waiting " + STALE_DAYS + "+ days", stale > 0 ? "bad" : "good")
                .tone("Median first reply", medianFirst == null ? "warn"
                        : ((Number) medianFirst).intValue() <= 24 ? "good"
                        : ((Number) medianFirst).intValue() <= 72 ? "warn" : "bad")
                .column("Learner")
                .column("Type")
                .column("Waiting")
                .column("Question");

        if (!incremental) {
            // The shape of the queue, for a weekly or monthly reader — the one who
            // should be judging the backlog rather than working today's arrivals.
            facts.headline("Open now", String.valueOf(openNow))
                    .headline("No reply yet", String.valueOf(unanswered))
                    .headline("Median to resolve", medianH == null
                            ? "—" : describeHours(((Number) medianH).intValue()))
                    .tone("No reply yet", unanswered > 0 ? "warn" : "good");
        }

        return facts
                .rows(rows)
                .build();
    }

    /** Hours are the stored unit; days are what a reader thinks in. */
    private static String describeHours(int hours) {
        if (hours < 24) return hours + "h";
        int days = hours / 24;
        return days == 1 ? "1 day" : days + " days";
    }

    private static int num(Object o) {
        return o == null ? 0 : ((Number) o).intValue();
    }

    private static String str(Object o, String fallback) {
        String v = o == null ? null : String.valueOf(o).trim();
        return (v == null || v.isEmpty()) ? fallback : v;
    }

    /**
     * Root doubts for this institute, optionally narrowed to one batch and to the
     * reader's own cohorts.
     *
     * Params: instituteId, batchScoped, batchId, cohortRestricted, cohortCsv.
     */
    private static final String ROOT_CTE = """
            WITH root AS (
                SELECT d.id, d.user_id, d.raised_time, d.resolved_time, d.status,
                       d.type, d.guest_name, d.html_text,
                       EXISTS (SELECT 1 FROM doubts r
                               WHERE r.parent_id = d.id
                                 AND r.status <> 'DELETED') AS answered,
                       -- Turnaround is measured to the FIRST reply, not to
                       -- resolution: a learner is unblocked when somebody answers,
                       -- and a thread can stay open long after that.
                       (SELECT min(r.created_at) FROM doubts r
                        WHERE r.parent_id = d.id
                          AND r.status <> 'DELETED') AS first_reply
                FROM doubts d
                WHERE d.institute_id = ?
                  AND d.parent_id IS NULL
                  AND d.status <> 'DELETED'
                  AND (NOT CAST(? AS boolean) OR d.package_session_id = ?)
                  AND (NOT CAST(? AS boolean)
                       OR d.package_session_id = ANY (string_to_array(?, ',')))
            )
            """;

    /**
     * The open queue is counted as-of-now; only the flow figures use the window.
     * Params: ROOT_CTE params, staleDays, then the window bounds three times.
     */
    private static final String SUMMARY_SQL = ROOT_CTE + """
            SELECT count(*) FILTER (WHERE status = 'ACTIVE') AS open_now,
                   count(*) FILTER (WHERE status = 'ACTIVE'
                                      AND NOT answered) AS unanswered,
                   count(*) FILTER (WHERE status = 'ACTIVE' AND NOT answered
                                      AND raised_time
                                          < now() - make_interval(days => ?)) AS stale,
                   count(*) FILTER (WHERE raised_time >= ?
                                      AND raised_time < ?) AS raised_in_window,
                   count(*) FILTER (WHERE status = 'RESOLVED'
                                      AND resolved_time >= ?
                                      AND resolved_time < ?) AS resolved_in_window,
                   round(percentile_cont(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (resolved_time - raised_time)) / 3600)
                       FILTER (WHERE status = 'RESOLVED'
                                 AND resolved_time >= ? AND resolved_time < ?
                                 -- Guard against clock skew producing a negative age.
                                 AND resolved_time >= raised_time)) AS median_h,
                   -- Bounded to doubts ANSWERED IN THE WINDOW. Computed over all
                   -- history these never move: measured across two consecutive daily
                   -- reports, median-first-reply and answered-in-a-day were byte
                   -- identical, which is a lifetime average wearing a period's
                   -- clothes.
                   round(percentile_cont(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (first_reply - raised_time)) / 3600)
                       FILTER (WHERE first_reply >= ? AND first_reply < ?
                                 AND first_reply >= raised_time)) AS median_first_reply_h,
                   count(*) FILTER (WHERE first_reply >= ? AND first_reply < ?) AS answered_in_window,
                   count(*) FILTER (WHERE first_reply >= ? AND first_reply < ?
                                      AND first_reply - raised_time
                                          < INTERVAL '24 hours') AS replied_within_day
            FROM root
            """;

    /**
     * The queue itself: never answered first, then longest waiting.
     *
     * The snippet pipeline is deliberately paranoid — see the class note on the
     * 998 KB inline-image case. Order of the two tag strips matters: complete tags
     * first, then any unterminated tail.
     *
     * Params: ROOT_CTE params, limit.
     */
    /**
     * What is NEW since the reader last heard from us: raised since then, or having
     * crossed the staleness threshold since then. Newest first, because on a daily
     * report the day's news is the point.
     *
     * The backlog query below orders OLDEST first, which on a daily cadence shows
     * the same twelve ancient doubts forever — measured on real data the eight
     * doubts raised that week ranked 25th and lower and never appeared at all.
     *
     * Params: ROOT_CTE params, since, staleDays, since, limit.
     */
    private static final String NEW_SINCE_SQL = ROOT_CTE + """
            SELECT r.user_id,
                   COALESCE(NULLIF(btrim(r.guest_name), ''), s.full_name) AS asker,
                   r.type,
                   r.answered,
                   GREATEST(0, date_part('day', now() - r.raised_time))::int AS days_waiting,
                   (r.raised_time >= ?) AS newly_raised,
                   left(btrim(
                     replace(replace(replace(replace(replace(replace(replace(
                       regexp_replace(
                         regexp_replace(
                           regexp_replace(
                             regexp_replace(left(r.html_text, 4000), '<[^>]*>', ' ', 'g'),
                           '<[^>]*$', ' ', 'g'),
                         '\\S{45,}', ' ', 'g'),
                       '\\s+', ' ', 'g'),
                     U&'\\FEFF', ''), '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'),
                     '&quot;', '"'), '&#39;', ''''), '&amp;', '&')
                   ), 90) AS snippet
            FROM root r
            LEFT JOIN LATERAL (
                SELECT st.full_name FROM student st
                WHERE st.user_id = r.user_id
                ORDER BY st.created_at DESC NULLS LAST LIMIT 1
            ) s ON TRUE
            WHERE r.status = 'ACTIVE'
              AND (
                -- newly arrived...
                r.raised_time >= ?
                -- ...or it went stale while the reader was not looking, which is a
                -- state change worth reporting even though the doubt is not new.
                OR (NOT r.answered
                    AND r.raised_time < now() - make_interval(days => ?)
                    -- Cast explicitly: a bare parameter minus an interval leaves
                    -- Postgres to infer the parameter type. Never write a literal
                    -- question mark in a SQL comment here -- the driver counts it
                    -- as a bind parameter.
                    AND r.raised_time >= CAST(? AS timestamptz)
                                         - make_interval(days => ?))
              )
            ORDER BY r.raised_time DESC
            LIMIT ?
            """;

    private static final String OPEN_SQL = ROOT_CTE + """
            SELECT r.user_id,
                   COALESCE(NULLIF(btrim(r.guest_name), ''), s.full_name) AS asker,
                   r.type,
                   r.answered,
                   GREATEST(0, date_part('day', now() - r.raised_time))::int AS days_waiting,
                   left(btrim(
                     replace(replace(replace(replace(replace(replace(replace(
                       regexp_replace(
                         regexp_replace(
                           regexp_replace(
                             regexp_replace(left(r.html_text, 4000), '<[^>]*>', ' ', 'g'),
                           '<[^>]*$', ' ', 'g'),
                         '\\S{45,}', ' ', 'g'),
                       '\\s+', ' ', 'g'),
                     U&'\\FEFF', ''), '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'),
                     '&quot;', '"'), '&#39;', ''''), '&amp;', '&')
                   ), 90) AS snippet
            FROM root r
            LEFT JOIN LATERAL (
                SELECT st.full_name FROM student st
                WHERE st.user_id = r.user_id
                ORDER BY st.created_at DESC NULLS LAST
                LIMIT 1
            ) s ON TRUE
            WHERE r.status = 'ACTIVE'
            ORDER BY r.answered ASC, r.raised_time ASC
            LIMIT ?
            """;
}
