package vacademy.io.assessment_service.features.certificate_scores.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.certificate_scores.dto.CertificateScoreRow;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * Best final marks per (learner, assessment), for admin_core's course certificate
 * criteria ("score at least 60% in the Final Test").
 *
 * <p><b>Which marks count.</b> Only ENDED attempts whose result is final and published:
 * {@code report_release_status = 'RELEASED'} and {@code result_status = 'COMPLETED'}.
 * Everything else is reported as {@code heldAttempts}: a manual result not yet released,
 * a NO_AUTO_RELEASE result the institute has not released, an AUTO_AFTER_ASSESSMENT_END
 * result before the test closes, and any attempt still being evaluated (PENDING,
 * EVALUATING, AI evaluation). A certificate must never be the first place a learner learns
 * they passed, nor be decided on marks that are still changing.
 *
 * <p><b>Maximum marks</b> are the sum of the live sections, the basis the batch and history
 * reports already use for percentages. {@code student_attempt.total_marks} is the marks the
 * learner earned (the column name is misleading); the submission review screen reads it too.
 *
 * <p>Read-only. No table, entity or migration.
 */
@Service
public class CertificateScoreService {

    /** Keeps each IN list well under the Postgres bind-parameter limit. */
    private static final int USER_CHUNK = 1000;

    private static final String SQL = """
            WITH achievable AS (
                SELECT s.assessment_id    AS assessment_id,
                       SUM(s.total_marks) AS max_marks
                FROM section s
                WHERE s.status <> 'DELETED'
                  AND s.assessment_id IN (:assessmentIds)
                GROUP BY s.assessment_id
            ),
            attempts AS (
                SELECT aur.user_id                    AS user_id,
                       aur.assessment_id              AS assessment_id,
                       COALESCE(sa.total_marks, 0)    AS marks,
                       CASE
                           WHEN sa.report_release_status = 'RELEASED'
                            AND sa.result_status = 'COMPLETED'
                           THEN FALSE ELSE TRUE
                       END                            AS held
                FROM student_attempt sa
                    JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                WHERE aur.assessment_id IN (:assessmentIds)
                  AND aur.user_id IN (:userIds)
                  AND sa.status = 'ENDED'
            )
            SELECT t.user_id                                AS user_id,
                   t.assessment_id                          AS assessment_id,
                   ach.max_marks                            AS max_marks,
                   MAX(t.marks) FILTER (WHERE NOT t.held)   AS best_marks,
                   COUNT(*) FILTER (WHERE NOT t.held)       AS final_attempts,
                   COUNT(*) FILTER (WHERE t.held)           AS held_attempts
            FROM attempts t
                LEFT JOIN achievable ach ON ach.assessment_id = t.assessment_id
            GROUP BY t.user_id, t.assessment_id, ach.max_marks
            """;

    private final NamedParameterJdbcTemplate jdbc;

    @Autowired
    public CertificateScoreService(JdbcTemplate jdbcTemplate) {
        this.jdbc = new NamedParameterJdbcTemplate(jdbcTemplate);
    }

    /**
     * @return one row per (learner, assessment) with at least one ENDED attempt; a pair
     *         with no attempt is simply absent, which the caller reads as not attempted
     */
    public List<CertificateScoreRow> bestScores(List<String> userIds, List<String> assessmentIds) {
        List<String> users = distinct(userIds);
        List<String> assessments = distinct(assessmentIds);
        if (users.isEmpty() || assessments.isEmpty()) {
            return List.of();
        }
        List<CertificateScoreRow> out = new ArrayList<>();
        for (int from = 0; from < users.size(); from += USER_CHUNK) {
            List<String> chunk = users.subList(from, Math.min(users.size(), from + USER_CHUNK));
            MapSqlParameterSource params = new MapSqlParameterSource()
                    .addValue("userIds", chunk)
                    .addValue("assessmentIds", assessments);
            out.addAll(jdbc.query(SQL, params, (rs, i) -> {
                Double max = nullableDouble(rs.getObject("max_marks"));
                Double best = nullableDouble(rs.getObject("best_marks"));
                long finalAttempts = rs.getLong("final_attempts");
                Double percent = (best != null && max != null && max > 0)
                        ? Math.round(best * 1000.0 / max) / 10.0
                        : null;
                return CertificateScoreRow.builder()
                        .userId(rs.getString("user_id"))
                        .assessmentId(rs.getString("assessment_id"))
                        .maxMarks(max)
                        .bestMarks(finalAttempts > 0 ? best : null)
                        .bestPercent(finalAttempts > 0 ? percent : null)
                        .finalAttempts(finalAttempts)
                        .heldAttempts(rs.getLong("held_attempts"))
                        .build();
            }));
        }
        return out;
    }

    private static List<String> distinct(List<String> values) {
        if (values == null) {
            return List.of();
        }
        LinkedHashSet<String> set = new LinkedHashSet<>();
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                set.add(value);
            }
        }
        return new ArrayList<>(set);
    }

    private static Double nullableDouble(Object value) {
        return value instanceof Number n ? n.doubleValue() : null;
    }
}
