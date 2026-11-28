package vacademy.io.assessment_service.features.reporting.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Institute-level assessment aggregate for the scheduled reporting platform.
 *
 * Exists because the only assessment data admin_core could previously reach was
 * {@code /internal/student-analysis/assessment-history}, which is PER LEARNER — at
 * 7,000 learners that is 7,000 HTTP calls inside a scheduled job. This computes the
 * whole institute in one query so a report costs one call.
 *
 * Read-only. No writes, no new tables, no migration.
 *
 * <h3>Two marks columns, and only one of them means what it says</h3>
 * {@code student_attempt.total_marks} is the marks the learner ACHIEVED, not the
 * paper's maximum — it equals {@code result_marks} and equals the sum of that
 * attempt's {@code question_wise_marks} on every row checked. Dividing one by the
 * other therefore yields exactly 100% for every learner, which is what a first
 * implementation of this reported. The real maximum is
 * {@code sum(section.total_marks)} for the assessment, and against that the
 * platform average is 49%.
 *
 * <h3>Scores that cannot be trusted are excluded, not clamped</h3>
 * Two populations are unusable for a percentage and are counted separately instead
 * of being quietly folded in:
 * <ul>
 *   <li>assessments whose sections sum to a zero maximum (135 attempts in a recent
 *       60 days) — there is nothing to divide by;
 *   <li>attempts scoring MORE than the paper's maximum (53 attempts, ~2%) — most
 *       likely a paper edited after the attempt. Clamping them to 100% would hide a
 *       real data problem inside a plausible number.
 * </ul>
 * Negative percentages are NOT excluded: negative marking legitimately produces
 * them, and the observed floor of -25% is a true score.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AssessmentReportingService {

    /** Assessments listed individually, worst participation first. */
    private static final int MAX_ROWS = 12;

    private final JdbcTemplate jdbcTemplate;

    public Map<String, Object> summary(String instituteId, Instant from, Instant to) {
        Timestamp start = Timestamp.from(from);
        Timestamp end = Timestamp.from(to);

        Map<String, Object> totals = jdbcTemplate.queryForMap(SUMMARY_SQL,
                instituteId, start, end);

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(BY_ASSESSMENT_SQL,
                instituteId, start, end, MAX_ROWS);

        List<Map<String, Object>> assessments = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) {
            // LinkedHashMap, NOT Map.of: avgScorePct is deliberately null when the
            // paper has no usable maximum, and Map.of throws NullPointerException on
            // a null value. The immutable factory turned the one field designed to
            // say "we cannot know" into a 500 that reached the config screen as
            // "no data in the last 30 days".
            Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("name", r.get("name") == null ? "" : r.get("name"));
            row.put("attempts", num(r.get("attempts")));
            row.put("awaitingEvaluation", num(r.get("awaiting")));
            row.put("scored", num(r.get("scored")));
            row.put("avgScorePct", r.get("avg_score_pct"));
            row.put("lastAttempt", String.valueOf(r.get("last_attempt")));
            assessments.add(row);
        }

        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("assessments", num(totals.get("assessments")));
        out.put("attempts", num(totals.get("attempts")));
        out.put("submitted", num(totals.get("submitted")));
        out.put("awaitingEvaluation", num(totals.get("awaiting")));
        out.put("scored", num(totals.get("scored")));
        out.put("avgScorePct", totals.get("avg_score_pct"));
        out.put("noMaximum", num(totals.get("no_maximum")));
        out.put("aboveMaximum", num(totals.get("above_maximum")));
        out.put("rows", assessments);
        return out;
    }

    private static int num(Object o) {
        return o == null ? 0 : ((Number) o).intValue();
    }

    /**
     * The maximum marks a paper is worth. Kept as a CTE rather than a join so both
     * queries below agree on the definition — two different notions of "out of" in
     * one report would be worse than none.
     */
    private static final String MAX_MARKS_CTE = """
            WITH max_marks AS (
                SELECT s.assessment_id, sum(s.total_marks) AS max_marks
                FROM section s
                WHERE COALESCE(s.status, '') <> 'DELETED'
                GROUP BY s.assessment_id
            ),
            att AS (
                SELECT sa.id, sa.result_status, sa.submit_time, sa.created_at,
                       sa.total_marks AS achieved,
                       r.assessment_id,
                       m.max_marks,
                       -- Usable for a percentage only with a positive maximum the
                       -- learner did not somehow exceed.
                       (m.max_marks > 0 AND sa.total_marks <= m.max_marks
                        AND sa.result_status = 'COMPLETED') AS scorable
                FROM student_attempt sa
                JOIN assessment_user_registration r ON r.id = sa.registration_id
                LEFT JOIN max_marks m ON m.assessment_id = r.assessment_id
                WHERE r.institute_id = ?
                  AND sa.created_at >= ? AND sa.created_at < ?
                  AND r.source IS DISTINCT FROM 'COPY_CHECK_ONLY'
            )
            """;

    /** Params: instituteId, windowStart, windowEnd. */
    private static final String SUMMARY_SQL = MAX_MARKS_CTE + """
            SELECT count(DISTINCT assessment_id)                       AS assessments,
                   count(*)                                           AS attempts,
                   count(submit_time)                                  AS submitted,
                   count(*) FILTER (WHERE result_status
                                          IN ('PENDING', 'EVALUATING')) AS awaiting,
                   count(*) FILTER (WHERE scorable)                    AS scored,
                   round(avg(100.0 * achieved / max_marks)
                         FILTER (WHERE scorable))                      AS avg_score_pct,
                   count(*) FILTER (WHERE result_status = 'COMPLETED'
                                      AND COALESCE(max_marks, 0) <= 0) AS no_maximum,
                   count(*) FILTER (WHERE result_status = 'COMPLETED'
                                      AND max_marks > 0
                                      AND achieved > max_marks)        AS above_maximum
            FROM att
            """;

    /**
     * One row per assessment attempted in the window, most attempts first.
     *
     * Params: instituteId, windowStart, windowEnd, limit.
     */
    private static final String BY_ASSESSMENT_SQL = MAX_MARKS_CTE + """
            SELECT a.name,
                   count(*)                                            AS attempts,
                   count(*) FILTER (WHERE att.result_status
                                          IN ('PENDING', 'EVALUATING')) AS awaiting,
                   count(*) FILTER (WHERE att.scorable)                AS scored,
                   round(avg(100.0 * att.achieved / att.max_marks)
                         FILTER (WHERE att.scorable))                  AS avg_score_pct,
                   max(att.created_at)::date                           AS last_attempt
            FROM att
            JOIN assessment a ON a.id = att.assessment_id
            GROUP BY a.id, a.name
            ORDER BY count(*) FILTER (WHERE att.result_status
                                           IN ('PENDING', 'EVALUATING')) DESC,
                     count(*) DESC
            LIMIT ?
            """;
}
