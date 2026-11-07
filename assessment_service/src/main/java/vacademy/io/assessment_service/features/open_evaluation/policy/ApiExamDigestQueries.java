package vacademy.io.assessment_service.features.open_evaluation.policy;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * Reads behind the once-a-day staff digest for partner-API exams (spec 12, item 5): per
 * API exam, how many copies the AI finished in the last window and how many failed.
 */
@Repository
public class ApiExamDigestQueries {

    /** One API exam's AI results in the digest window. */
    public record ExamDigest(String assessmentId, String instituteId, String assessmentName, String playMode,
            String visibility, long checked, long failed) {
    }

    private final NamedParameterJdbcTemplate jdbc;

    public ApiExamDigestQueries(JdbcTemplate jdbcTemplate) {
        this.jdbc = new NamedParameterJdbcTemplate(jdbcTemplate);
    }

    /**
     * API exams with AI runs that settled at or after {@code since} and whose digest has not
     * been sent for {@code day}.
     */
    public List<ExamDigest> pendingDigests(Instant since, LocalDate day) {
        return jdbc.query("""
                SELECT p.assessment_id, ae.institute_id, a.name, a.play_mode, a.assessment_visibility,
                       COUNT(*) FILTER (WHERE p.status = 'COMPLETED') AS checked,
                       COUNT(*) FILTER (WHERE p.status = 'FAILED') AS failed
                FROM ai_evaluation_process p
                JOIN api_exam ae ON ae.assessment_id = p.assessment_id
                JOIN assessment a ON a.id = p.assessment_id
                WHERE p.status IN ('COMPLETED', 'FAILED')
                  AND p.completed_at >= :since
                  AND (ae.digest_sent_on IS NULL OR ae.digest_sent_on < :day)
                GROUP BY p.assessment_id, ae.institute_id, a.name, a.play_mode, a.assessment_visibility
                """,
                new MapSqlParameterSource()
                        .addValue("since", Timestamp.valueOf(LocalDateTime.ofInstant(since, ZoneOffset.UTC)))
                        .addValue("day", day),
                (rs, i) -> new ExamDigest(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getLong(6), rs.getLong(7)));
    }

    /**
     * Claims today's digest for one exam. Exactly one pod gets {@code true}; the others see
     * the row already stamped and stay quiet.
     */
    public boolean claimDigest(String assessmentId, LocalDate day) {
        return jdbc.update("""
                UPDATE api_exam SET digest_sent_on = :day
                WHERE assessment_id = :assessmentId AND (digest_sent_on IS NULL OR digest_sent_on < :day)
                """,
                new MapSqlParameterSource().addValue("assessmentId", assessmentId).addValue("day", day)) == 1;
    }
}
