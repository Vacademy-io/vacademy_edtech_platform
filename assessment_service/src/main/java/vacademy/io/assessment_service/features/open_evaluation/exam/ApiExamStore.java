package vacademy.io.assessment_service.features.open_evaluation.exam;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import vacademy.io.assessment_service.features.open_evaluation.support.Paging;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * {@code api_exam} rows (V54) joined with their {@code assessment}. Every read is scoped by
 * institute: an exam of another institute is simply not found (spec 8.3, 404 never 403).
 */
@Repository
public class ApiExamStore {

    /** One API exam: the facade row plus the assessment fields the API exposes. */
    public record ApiExamRow(
            String assessmentId,
            String instituteId,
            String keyId,
            String externalRef,
            String mode,
            String level,
            String subject,
            String board,
            String className,
            String answerLanguage,
            String feedbackLanguage,
            /** Stored escaped (plain-text rule); unescape before returning it. */
            String instructions,
            LocalDate conductedOn,
            boolean blind,
            Instant openedAt,
            Instant finalizedAt,
            Instant createdAt,
            Instant updatedAt,
            String title,
            String assessmentStatus,
            boolean rubricPending) {

        public boolean isDraft() {
            return assessmentStatus == null || "DRAFT".equalsIgnoreCase(assessmentStatus);
        }

        public boolean isOpen() {
            return "PUBLISHED".equalsIgnoreCase(assessmentStatus);
        }

        public boolean isDeleted() {
            return "DELETED".equalsIgnoreCase(assessmentStatus);
        }

        public boolean isFinalized() {
            return finalizedAt != null;
        }

        public boolean isTyped() {
            return ExamValidator.MODE_TYPED.equals(mode);
        }
    }

    private static final String SELECT = """
            SELECT ae.assessment_id, ae.institute_id, ae.key_id,
                   COALESCE(ae.external_ref, ae.deleted_external_ref) AS external_ref, ae.mode, ae.level, ae.subject,
                   ae.board, ae.class_name, ae.answer_language, ae.feedback_language, ae.instructions, ae.conducted_on,
                   ae.blind, ae.opened_at, ae.finalized_at, ae.created_at, ae.updated_at,
                   a.name AS title, a.status AS assessment_status,
                   (ae.rubric_pending IS NOT NULL) AS rubric_pending
            FROM api_exam ae
            JOIN assessment a ON a.id = ae.assessment_id
            """;

    private static final RowMapper<ApiExamRow> ROW = ApiExamStore::map;

    private final NamedParameterJdbcTemplate jdbc;

    @Autowired
    public ApiExamStore(JdbcTemplate jdbcTemplate) {
        this.jdbc = new NamedParameterJdbcTemplate(jdbcTemplate);
    }

    ApiExamStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(String assessmentId, String instituteId, String keyId, ExamValidator.ValidatedExam exam,
            String escapedInstructions) {
        jdbc.update("""
                INSERT INTO api_exam (assessment_id, institute_id, key_id, external_ref, mode, level, subject, board,
                                      class_name, answer_language, feedback_language, instructions, conducted_on, blind,
                                      created_at, updated_at)
                VALUES (:assessmentId, :instituteId, :keyId, :externalRef, :mode, :level, :subject, :board,
                        :className, :answerLanguage, :feedbackLanguage, :instructions, :conductedOn, :blind, now(), now())
                """, new MapSqlParameterSource()
                .addValue("assessmentId", assessmentId)
                .addValue("instituteId", instituteId)
                .addValue("keyId", keyId)
                .addValue("externalRef", exam.externalRef())
                .addValue("mode", exam.mode())
                .addValue("level", exam.level())
                .addValue("subject", exam.subject())
                .addValue("board", exam.board())
                .addValue("className", exam.className())
                .addValue("answerLanguage", exam.answerLanguage())
                .addValue("feedbackLanguage", exam.feedbackLanguage())
                .addValue("instructions", escapedInstructions)
                .addValue("conductedOn", exam.conductedOn() == null ? null : Date.valueOf(exam.conductedOn()))
                .addValue("blind", exam.blind()));
    }

    /** The exam if it belongs to this institute (any status, deleted included). */
    public Optional<ApiExamRow> find(String instituteId, String examId) {
        if (examId == null || instituteId == null) {
            return Optional.empty();
        }
        List<ApiExamRow> rows = jdbc.query(SELECT + " WHERE ae.assessment_id = :id AND ae.institute_id = :inst",
                new MapSqlParameterSource().addValue("id", examId).addValue("inst", instituteId), ROW);
        return rows.stream().findFirst();
    }

    /** Same as {@link #find} but locks the api_exam row for the rest of the transaction. */
    public Optional<ApiExamRow> findForUpdate(String instituteId, String examId) {
        if (examId == null || instituteId == null) {
            return Optional.empty();
        }
        List<ApiExamRow> rows = jdbc.query(SELECT + " WHERE ae.assessment_id = :id AND ae.institute_id = :inst FOR UPDATE OF ae",
                new MapSqlParameterSource().addValue("id", examId).addValue("inst", instituteId), ROW);
        return rows.stream().findFirst();
    }

    public Optional<String> findIdByExternalRef(String instituteId, String externalRef) {
        if (externalRef == null) {
            return Optional.empty();
        }
        List<String> ids = jdbc.queryForList(
                "SELECT assessment_id FROM api_exam WHERE institute_id = :inst AND external_ref = :ref",
                new MapSqlParameterSource().addValue("inst", instituteId).addValue("ref", externalRef), String.class);
        return ids.stream().findFirst();
    }

    public List<ApiExamRow> findByExternalRefs(String instituteId, Collection<String> refs) {
        if (refs == null || refs.isEmpty()) {
            return List.of();
        }
        return jdbc.query(SELECT + " WHERE ae.institute_id = :inst AND ae.external_ref IN (:refs) ORDER BY ae.created_at, ae.assessment_id",
                new MapSqlParameterSource().addValue("inst", instituteId).addValue("refs", refs), ROW);
    }

    /**
     * One page of the institute's API exams ordered by {@code (updated_at, id)}.
     *
     * @param statuses assessment statuses to include (DRAFT, PUBLISHED, DELETED); null = all but DELETED
     * @param finalized null = any; true/false = only finalized / not finalized
     */
    public List<ApiExamRow> list(String instituteId, Collection<String> statuses, Boolean finalized, Instant updatedSince,
            Paging.Cursor after, int fetch) {
        StringBuilder sql = new StringBuilder(SELECT).append(" WHERE ae.institute_id = :inst");
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("inst", instituteId).addValue("fetch", fetch);
        if (statuses == null || statuses.isEmpty()) {
            sql.append(" AND a.status <> 'DELETED'");
        } else {
            sql.append(" AND a.status IN (:statuses)");
            p.addValue("statuses", statuses);
        }
        if (finalized != null) {
            sql.append(finalized ? " AND ae.finalized_at IS NOT NULL" : " AND ae.finalized_at IS NULL");
        }
        if (updatedSince != null) {
            sql.append(" AND ae.updated_at > :since");
            p.addValue("since", Timestamp.from(updatedSince));
        }
        if (after != null) {
            sql.append(" AND (ae.updated_at, ae.assessment_id) > (:afterTs, :afterId)");
            p.addValue("afterTs", Paging.timestamp(after)).addValue("afterId", after.id());
        }
        sql.append(" ORDER BY ae.updated_at, ae.assessment_id LIMIT :fetch");
        return jdbc.query(sql.toString(), p, ROW);
    }

    /** Writes the editable facade columns back (PATCH /exams/{id}) and bumps updated_at. */
    public void updateDetails(String examId, String externalRef, String mode, String level, String subject, String board,
            String className, String feedbackLanguage, String escapedInstructions, LocalDate conductedOn, boolean blind) {
        jdbc.update("""
                UPDATE api_exam SET external_ref = :externalRef, mode = :mode, level = :level, subject = :subject,
                       board = :board, class_name = :className, feedback_language = :feedbackLanguage,
                       instructions = :instructions, conducted_on = :conductedOn, blind = :blind, updated_at = now()
                WHERE assessment_id = :id
                """, new MapSqlParameterSource()
                .addValue("id", examId)
                .addValue("externalRef", externalRef)
                .addValue("mode", mode)
                .addValue("level", level)
                .addValue("subject", subject)
                .addValue("board", board)
                .addValue("className", className)
                .addValue("feedbackLanguage", feedbackLanguage)
                .addValue("instructions", escapedInstructions)
                .addValue("conductedOn", conductedOn == null ? null : Date.valueOf(conductedOn))
                .addValue("blind", blind));
    }

    public void markOpened(String examId, Instant openedAt) {
        jdbc.update("UPDATE api_exam SET opened_at = :at, updated_at = now() WHERE assessment_id = :id",
                new MapSqlParameterSource().addValue("id", examId).addValue("at", Timestamp.from(openedAt)));
    }

    /** Every submission is finalized (spec 8.2: exam status {@code finalized} is derived). */
    public void markFinalized(String examId) {
        jdbc.update("UPDATE api_exam SET finalized_at = now(), updated_at = now() WHERE assessment_id = :id "
                + "AND finalized_at IS NULL", new MapSqlParameterSource().addValue("id", examId));
    }

    /** A submission was unfinalized: the exam is open again. */
    public void clearFinalized(String examId) {
        jdbc.update("UPDATE api_exam SET finalized_at = NULL, updated_at = now() WHERE assessment_id = :id "
                + "AND finalized_at IS NOT NULL", new MapSqlParameterSource().addValue("id", examId));
    }

    /**
     * On delete: frees the partner's external_ref for a new exam (the unique index covers
     * live and deleted rows alike) and keeps it in deleted_external_ref, so the deleted exam
     * still shows it in the feed.
     */
    public void releaseExternalRef(String examId) {
        jdbc.update("""
                UPDATE api_exam SET deleted_external_ref = external_ref, external_ref = NULL, updated_at = now()
                WHERE assessment_id = :id AND external_ref IS NOT NULL
                """, new MapSqlParameterSource().addValue("id", examId));
    }

    /** Bumps updated_at so {@code GET /exams?updated_since=} sees the change. */
    public void touch(String examId) {
        jdbc.update("UPDATE api_exam SET updated_at = now() WHERE assessment_id = :id",
                new MapSqlParameterSource().addValue("id", examId));
    }

    /** Any attempt exists on the exam (dashboard upload or API submission). */
    public boolean hasSubmissions(String examId) {
        Boolean exists = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM api_submission s WHERE s.exam_id = :id AND s.status <> 'DELETED')
                    OR EXISTS (SELECT 1 FROM student_attempt sa
                               JOIN assessment_user_registration r ON r.id = sa.registration_id
                               WHERE r.assessment_id = :id)
                """, new MapSqlParameterSource().addValue("id", examId), Boolean.class);
        return Boolean.TRUE.equals(exists);
    }

    /** An AI run on the exam finished or is still running (failed and cancelled runs do not count). */
    public boolean hasGradedOrRunningEvaluation(String examId) {
        Boolean exists = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM ai_evaluation_process p
                               WHERE p.assessment_id = :id AND p.status NOT IN ('FAILED', 'CANCELLED'))
                """, new MapSqlParameterSource().addValue("id", examId), Boolean.class);
        return Boolean.TRUE.equals(exists);
    }

    /**
     * {@code stats} of {@code GET /exams/{id}?include=stats} (spec 7.1): registrations, live
     * submissions and the public status of each submission's latest AI run.
     */
    public Map<String, Object> stats(String examId) {
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("id", examId);
        Long candidates = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_user_registration WHERE assessment_id = :id AND status <> 'DELETED'",
                p, Long.class);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("candidates", candidates == null ? 0 : candidates);
        jdbc.query("""
                SELECT COUNT(*) AS submissions,
                       COUNT(*) FILTER (WHERE lp.status IN ('PENDING','STARTED','DISPATCHED','REQUEUED')) AS queued,
                       COUNT(*) FILTER (WHERE lp.status IN ('PROCESSING','EXTRACTING','EVALUATING','GRADING','IN_PROGRESS')) AS processing,
                       COUNT(*) FILTER (WHERE lp.status IS NULL OR (lp.status = 'COMPLETED' AND NOT lp.any_failed)) AS graded,
                       COUNT(*) FILTER (WHERE lp.status = 'COMPLETED' AND lp.any_failed) AS partially_graded,
                       COUNT(*) FILTER (WHERE lp.status = 'FAILED') AS failed,
                       COUNT(*) FILTER (WHERE sa.report_release_status = 'RELEASED') AS finalized
                FROM api_submission s
                JOIN student_attempt sa ON sa.id = s.attempt_id
                LEFT JOIN LATERAL (
                    SELECT p.status,
                           EXISTS (SELECT 1 FROM ai_question_evaluation q
                                   WHERE q.evaluation_process_id = p.id AND q.status = 'FAILED') AS any_failed
                    FROM ai_evaluation_process p
                    WHERE p.attempt_id = s.attempt_id
                    ORDER BY p.created_at DESC
                    LIMIT 1
                ) lp ON TRUE
                WHERE s.exam_id = :id AND s.status = 'LIVE'
                """, p, rs -> {
            out.put("submissions", rs.getLong("submissions"));
            out.put("queued", rs.getLong("queued"));
            out.put("processing", rs.getLong("processing"));
            out.put("graded", rs.getLong("graded"));
            out.put("partially_graded", rs.getLong("partially_graded"));
            out.put("failed", rs.getLong("failed"));
            out.put("finalized", rs.getLong("finalized"));
        });
        return out;
    }

    private static ApiExamRow map(ResultSet rs, int i) throws SQLException {
        Date conducted = rs.getDate("conducted_on");
        return new ApiExamRow(
                rs.getString("assessment_id"),
                rs.getString("institute_id"),
                rs.getString("key_id"),
                rs.getString("external_ref"),
                rs.getString("mode"),
                rs.getString("level"),
                rs.getString("subject"),
                rs.getString("board"),
                rs.getString("class_name"),
                rs.getString("answer_language"),
                rs.getString("feedback_language"),
                rs.getString("instructions"),
                conducted == null ? null : conducted.toLocalDate(),
                rs.getBoolean("blind"),
                instant(rs, "opened_at"),
                instant(rs, "finalized_at"),
                instant(rs, "created_at"),
                instant(rs, "updated_at"),
                rs.getString("title"),
                rs.getString("assessment_status"),
                rs.getBoolean("rubric_pending"));
    }

    static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }
}
