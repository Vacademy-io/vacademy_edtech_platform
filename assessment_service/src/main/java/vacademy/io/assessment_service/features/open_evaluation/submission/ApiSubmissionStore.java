package vacademy.io.assessment_service.features.open_evaluation.submission;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import vacademy.io.assessment_service.features.open_evaluation.support.Paging;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * {@code api_submission} (V54) and the read model behind every submission response: the
 * submission, its candidate, its attempt and the attempt's latest AI run. One LIVE row per
 * (exam, candidate) is enforced by {@code ux_api_submission_live}. Every read is scoped by
 * institute; another institute's submission is simply not found.
 */
@Repository
public class ApiSubmissionStore {

    public static final String LIVE = "LIVE";
    public static final String REPLACED = "REPLACED";
    public static final String DELETED = "DELETED";

    /** The facade row of one submission (writes). */
    public record SubmissionRow(String attemptId, String examId, String candidateId, String instituteId, String status,
            String mode, Integer pages) {
    }

    /** One submission as the API shows it (reads). */
    public record SubmissionView(
            String attemptId, String examId, String candidateId, String instituteId, String keyId, String state,
            String mode, String uploadId, Integer pages, String metadataJson, String reviewReasonsJson,
            Instant approvedAt, String replacedBy, Instant createdAt, Instant updatedAt,
            String candidateExternalId, String candidateName, String candidateRoll,
            String reportReleaseStatus, Instant reportLastReleaseDate, String evaluatedFileId, String resultStatus,
            String processId, String processStatus, String currentStep, Integer questionsCompleted,
            Integer questionsTotal, String errorMessage, BigDecimal quotedCredits, Instant processCreatedAt,
            Instant processStartedAt, Instant processCompletedAt, String lane, Integer pageCount,
            String processInstituteId, long runs, boolean anyQuestionFailed, boolean questionNeedsReview,
            Integer rubricVersion) {

        public boolean isLive() {
            return LIVE.equals(state);
        }

        public boolean isFinalized() {
            return "RELEASED".equals(reportReleaseStatus);
        }
    }

    /** Filters of {@code GET /exams/{id}/submissions} and {@code GET /submissions}. */
    public record Filters(List<String> statuses, Boolean needsReview, Boolean finalized, String candidateId,
            Instant updatedSince) {
        public static Filters none() {
            return new Filters(null, null, null, null, null);
        }
    }

    static final String VIEW_SQL = """
            SELECT s.attempt_id, s.exam_id, s.candidate_id, s.institute_id, s.key_id, s.status AS state, s.mode,
                   s.upload_id, s.pages, s.metadata::text AS metadata, s.review_reasons::text AS review_reasons,
                   s.approved_at, s.replaced_by, s.created_at, s.updated_at,
                   c.external_id AS candidate_external_id, c.name AS candidate_name, c.roll_number AS candidate_roll,
                   sa.report_release_status, sa.report_last_release_date, sa.evaluated_file_id, sa.result_status,
                   lp.id AS process_id, lp.status AS process_status, lp.current_step, lp.questions_completed,
                   lp.questions_total, lp.error_message, lp.quoted_credits, lp.created_at AS process_created_at,
                   lp.started_at AS process_started_at, lp.completed_at AS process_completed_at, lp.lane,
                   lp.page_count, lp.institute_id AS process_institute_id,
                   COALESCE(lp.runs, 0) AS runs, COALESCE(lp.any_failed, FALSE) AS any_failed,
                   COALESCE(lp.question_needs_review, FALSE) AS question_needs_review, lp.rubric_version
            FROM api_submission s
            JOIN student_attempt sa ON sa.id = s.attempt_id
            JOIN api_candidate c ON c.id = s.candidate_id
            LEFT JOIN LATERAL (
                SELECT p.id, p.status, p.current_step, p.questions_completed, p.questions_total, p.error_message,
                       p.quoted_credits, p.created_at, p.started_at, p.completed_at, p.lane, p.page_count, p.institute_id,
                       (SELECT COUNT(*) FROM ai_evaluation_process x WHERE x.attempt_id = s.attempt_id) AS runs,
                       EXISTS (SELECT 1 FROM ai_question_evaluation q
                               WHERE q.evaluation_process_id = p.id AND q.status = 'FAILED') AS any_failed,
                       EXISTS (SELECT 1 FROM ai_question_evaluation q
                               WHERE q.evaluation_process_id = p.id
                                 AND NOT COALESCE(q.is_edited, FALSE)
                                 AND (q.review_meta IS NULL OR q.review_meta->>'approved_by' IS NULL)
                                 AND (q.status = 'FAILED'
                                      OR (q.status = 'COMPLETED'
                                          AND (CAST(substring(q.evaluation_result_json
                                                    from '"confidence":(-?[0-9]+(?:[.][0-9]*)?(?:[eE][-+]?[0-9]+)?)') AS NUMERIC) < 0.6
                                               OR q.evaluation_result_json LIKE '%"review_reasons":["%')))
                       ) AS question_needs_review,
                       (SELECT MAX(q.rubric_version) FROM ai_question_evaluation q
                        WHERE q.evaluation_process_id = p.id) AS rubric_version
                FROM ai_evaluation_process p
                WHERE p.attempt_id = s.attempt_id
                ORDER BY p.created_at DESC
                LIMIT 1
            ) lp ON TRUE
            """;

    private static final RowMapper<SubmissionView> VIEW = ApiSubmissionStore::mapView;

    private final NamedParameterJdbcTemplate jdbc;

    @Autowired
    public ApiSubmissionStore(JdbcTemplate jdbcTemplate) {
        this.jdbc = new NamedParameterJdbcTemplate(jdbcTemplate);
    }

    ApiSubmissionStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------ writes

    public void insert(String attemptId, String examId, String candidateId, String instituteId, String keyId,
            String mode, String uploadId, Integer pages, String metadataJson, String reviewReasonsJson) {
        jdbc.update("""
                INSERT INTO api_submission (attempt_id, exam_id, candidate_id, institute_id, status, key_id, mode,
                                            upload_id, pages, metadata, review_reasons, created_at, updated_at)
                VALUES (:attempt, :exam, :cand, :inst, 'LIVE', :key, :mode, :upload, :pages, CAST(:meta AS jsonb),
                        CAST(:reasons AS jsonb), now(), now())
                """, new MapSqlParameterSource()
                .addValue("attempt", attemptId)
                .addValue("exam", examId)
                .addValue("cand", candidateId)
                .addValue("inst", instituteId)
                .addValue("key", keyId)
                .addValue("mode", mode)
                .addValue("upload", uploadId)
                .addValue("pages", pages)
                .addValue("meta", metadataJson)
                .addValue("reasons", reviewReasonsJson));
    }

    /** The LIVE submission of a candidate on an exam, locked for the rest of the transaction. */
    public Optional<SubmissionRow> findLiveForUpdate(String examId, String candidateId) {
        return jdbc.query("""
                SELECT attempt_id, exam_id, candidate_id, institute_id, status, mode, pages FROM api_submission
                WHERE exam_id = :exam AND candidate_id = :cand AND status = 'LIVE' FOR UPDATE
                """, new MapSqlParameterSource().addValue("exam", examId).addValue("cand", candidateId), ApiSubmissionStore::mapRow)
                .stream().findFirst();
    }

    /** One submission of the institute, locked for the rest of the transaction. */
    public Optional<SubmissionRow> findForUpdate(String instituteId, String attemptId) {
        if (instituteId == null || attemptId == null) {
            return Optional.empty();
        }
        return jdbc.query("""
                SELECT attempt_id, exam_id, candidate_id, institute_id, status, mode, pages FROM api_submission
                WHERE attempt_id = :attempt AND institute_id = :inst FOR UPDATE
                """, new MapSqlParameterSource().addValue("attempt", attemptId).addValue("inst", instituteId),
                ApiSubmissionStore::mapRow).stream().findFirst();
    }

    /** Locks the registration row: createOfflineAttempt numbers attempts as size + 1 with no lock of its own. */
    public void lockRegistration(String registrationId) {
        jdbc.query("SELECT id FROM assessment_user_registration WHERE id = :id FOR UPDATE",
                new MapSqlParameterSource("id", registrationId), rs -> {
                });
    }

    /**
     * Locks api_submission rows, in id order: the same row lock re-evaluate, cancel and
     * delete take (findForUpdate), so finalize and those calls serialise on it.
     */
    public void lockSubmissions(Collection<String> attemptIds) {
        if (attemptIds == null || attemptIds.isEmpty()) {
            return;
        }
        jdbc.query("SELECT attempt_id FROM api_submission WHERE attempt_id IN (:ids) ORDER BY attempt_id FOR UPDATE",
                new MapSqlParameterSource("ids", attemptIds), rs -> {
                });
    }

    /** Locks attempt rows (finalize) so a concurrent override of the attempt waits. */
    public void lockAttempts(Collection<String> attemptIds) {
        if (attemptIds == null || attemptIds.isEmpty()) {
            return;
        }
        jdbc.query("SELECT id FROM student_attempt WHERE id IN (:ids) ORDER BY id FOR UPDATE",
                new MapSqlParameterSource("ids", attemptIds), rs -> {
                });
    }

    /**
     * Moves a LIVE submission off LIVE (replace step 4). Must run BEFORE the new LIVE row is
     * inserted: the partial unique index ux_api_submission_live is checked per row, not deferred.
     */
    public int markReplaced(String attemptId) {
        return jdbc.update("""
                UPDATE api_submission SET status = 'REPLACED', updated_at = now()
                WHERE attempt_id = :attempt AND status = 'LIVE'
                """, new MapSqlParameterSource().addValue("attempt", attemptId));
    }

    /** Links a REPLACED submission to the one that replaced it, once the new row exists. */
    public int linkReplacedBy(String attemptId, String replacedBy) {
        return jdbc.update("""
                UPDATE api_submission SET replaced_by = :by, updated_at = now()
                WHERE attempt_id = :attempt AND status = 'REPLACED'
                """, new MapSqlParameterSource().addValue("attempt", attemptId).addValue("by", replacedBy));
    }

    public int markDeleted(String attemptId) {
        return jdbc.update("""
                UPDATE api_submission SET status = 'DELETED', updated_at = now()
                WHERE attempt_id = :attempt AND status = 'LIVE'
                """, new MapSqlParameterSource("attempt", attemptId));
    }

    /** The attempt row itself leaves the dashboard's lists (they filter attempt status). */
    public int markAttemptDeleted(String attemptId) {
        return jdbc.update("UPDATE student_attempt SET status = 'DELETED' WHERE id = :attempt",
                new MapSqlParameterSource("attempt", attemptId));
    }

    public void setApproved(String attemptId, String approvedBy) {
        jdbc.update("UPDATE api_submission SET approved_at = now(), approved_by = :by, updated_at = now() "
                        + "WHERE attempt_id = :attempt",
                new MapSqlParameterSource().addValue("attempt", attemptId).addValue("by", approvedBy));
    }

    /** A new AI run invalidates the previous approval. */
    public void clearApproved(String attemptId) {
        jdbc.update("UPDATE api_submission SET approved_at = NULL, approved_by = NULL, updated_at = now() "
                + "WHERE attempt_id = :attempt", new MapSqlParameterSource("attempt", attemptId));
    }

    // ------------------------------------------------------------------ reads

    public Optional<SubmissionView> findView(String instituteId, String attemptId) {
        if (instituteId == null || attemptId == null) {
            return Optional.empty();
        }
        return jdbc.query(VIEW_SQL + " WHERE s.attempt_id = :attempt AND s.institute_id = :inst",
                new MapSqlParameterSource().addValue("attempt", attemptId).addValue("inst", instituteId), VIEW)
                .stream().findFirst();
    }

    public List<SubmissionView> findViews(String instituteId, Collection<String> attemptIds) {
        if (instituteId == null || attemptIds == null || attemptIds.isEmpty()) {
            return List.of();
        }
        return jdbc.query(VIEW_SQL + " WHERE s.attempt_id IN (:ids) AND s.institute_id = :inst",
                new MapSqlParameterSource().addValue("ids", attemptIds).addValue("inst", instituteId), VIEW);
    }

    /**
     * One page ordered by {@code (updated_at, id)}.
     *
     * @param examId   null = every exam of the institute (the feed)
     * @param liveOnly true for an exam's list; the feed also returns replaced and deleted
     *                 submissions so a sync loop learns about them
     */
    public List<SubmissionView> list(String instituteId, String examId, boolean liveOnly, Filters filters,
            Paging.Cursor after, int fetch) {
        StringBuilder inner = new StringBuilder(VIEW_SQL).append(" WHERE s.institute_id = :inst");
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("inst", instituteId).addValue("fetch", fetch);
        if (examId != null) {
            inner.append(" AND s.exam_id = :exam");
            p.addValue("exam", examId);
        }
        if (liveOnly) {
            inner.append(" AND s.status = 'LIVE'");
        }
        Filters f = filters == null ? Filters.none() : filters;
        if (f.candidateId() != null) {
            inner.append(" AND s.candidate_id = :cand");
            p.addValue("cand", f.candidateId());
        }
        if (f.updatedSince() != null) {
            inner.append(" AND s.updated_at > :since");
            p.addValue("since", Timestamp.from(f.updatedSince()));
        }
        if (after != null) {
            inner.append(" AND (s.updated_at, s.attempt_id) > (:afterTs, :afterId)");
            p.addValue("afterTs", Paging.timestamp(after)).addValue("afterId", after.id());
        }
        StringBuilder sql = new StringBuilder("SELECT * FROM (").append(inner).append(") v WHERE TRUE");
        if (f.finalized() != null) {
            sql.append(f.finalized() ? " AND v.report_release_status = 'RELEASED'"
                    : " AND (v.report_release_status IS NULL OR v.report_release_status <> 'RELEASED')");
        }
        if (f.needsReview() != null) {
            String needs = "(v.question_needs_review OR (v.review_reasons IS NOT NULL AND v.review_reasons <> '[]'"
                    + " AND v.approved_at IS NULL))";
            sql.append(f.needsReview() ? " AND " + needs : " AND NOT " + needs);
        }
        if (f.statuses() != null && !f.statuses().isEmpty()) {
            List<String> clauses = new ArrayList<>();
            for (String status : f.statuses()) {
                String clause = statusClause(status);
                if (clause != null) {
                    clauses.add(clause);
                }
            }
            sql.append(clauses.isEmpty() ? " AND FALSE" : " AND (" + String.join(" OR ", clauses) + ")");
        }
        sql.append(" ORDER BY v.updated_at, v.attempt_id LIMIT :fetch");
        return jdbc.query(sql.toString(), p, VIEW);
    }

    /** SQL for one public status (spec 8.1) over the view's latest-run columns; null when unknown. */
    static String statusClause(String publicStatus) {
        if (publicStatus == null) {
            return null;
        }
        return switch (publicStatus.trim().toLowerCase(Locale.ROOT)) {
            case "queued" -> "v.process_status IN ('PENDING', 'STARTED', 'DISPATCHED', 'REQUEUED')";
            case "processing" -> "v.process_status = 'PROCESSING'";
            case "reading" -> "v.process_status = 'EXTRACTING'";
            case "grading" -> "v.process_status IN ('EVALUATING', 'GRADING', 'IN_PROGRESS')";
            case "graded" -> "(v.process_status IS NULL OR (v.process_status = 'COMPLETED' AND NOT v.any_failed))";
            case "partially_graded" -> "(v.process_status = 'COMPLETED' AND v.any_failed)";
            case "failed" -> "v.process_status = 'FAILED'";
            case "cancelled" -> "v.process_status = 'CANCELLED'";
            default -> null;
        };
    }

    /**
     * The exam's LIVE submissions that are not finalized and whose public status is one of
     * {@code statuses}, oldest first ({@code all_graded} finalize).
     */
    public List<SubmissionView> unfinalizedForExam(String instituteId, String examId, List<String> statuses, int fetch) {
        List<String> clauses = statuses.stream().map(ApiSubmissionStore::statusClause).filter(c -> c != null).toList();
        String sql = "SELECT * FROM (" + VIEW_SQL + " WHERE s.institute_id = :inst AND s.exam_id = :exam"
                + " AND s.status = 'LIVE') v WHERE (v.report_release_status IS NULL OR v.report_release_status <> 'RELEASED')"
                + (clauses.isEmpty() ? " AND FALSE" : " AND (" + String.join(" OR ", clauses) + ")")
                + " ORDER BY v.created_at, v.attempt_id LIMIT :fetch";
        return jdbc.query(sql, new MapSqlParameterSource().addValue("inst", instituteId).addValue("exam", examId)
                .addValue("fetch", fetch), VIEW);
    }

    /** True when every LIVE submission of the exam is finalized (and there is at least one). */
    public boolean allFinalized(String examId) {
        Boolean all = jdbc.queryForObject("""
                SELECT COUNT(*) > 0 AND COUNT(*) FILTER (WHERE sa.report_release_status IS DISTINCT FROM 'RELEASED') = 0
                FROM api_submission s JOIN student_attempt sa ON sa.id = s.attempt_id
                WHERE s.exam_id = :exam AND s.status = 'LIVE'
                """, new MapSqlParameterSource("exam", examId), Boolean.class);
        return Boolean.TRUE.equals(all);
    }

    // ------------------------------------------------------------------ mapping

    private static SubmissionRow mapRow(ResultSet rs, int i) throws SQLException {
        return new SubmissionRow(rs.getString("attempt_id"), rs.getString("exam_id"), rs.getString("candidate_id"),
                rs.getString("institute_id"), rs.getString("status"), rs.getString("mode"),
                (Integer) rs.getObject("pages"));
    }

    private static SubmissionView mapView(ResultSet rs, int i) throws SQLException {
        return new SubmissionView(
                rs.getString("attempt_id"), rs.getString("exam_id"), rs.getString("candidate_id"),
                rs.getString("institute_id"), rs.getString("key_id"), rs.getString("state"), rs.getString("mode"),
                rs.getString("upload_id"), (Integer) rs.getObject("pages"), rs.getString("metadata"),
                rs.getString("review_reasons"), instant(rs, "approved_at"), rs.getString("replaced_by"),
                instant(rs, "created_at"), instant(rs, "updated_at"),
                rs.getString("candidate_external_id"), rs.getString("candidate_name"), rs.getString("candidate_roll"),
                rs.getString("report_release_status"), instant(rs, "report_last_release_date"),
                rs.getString("evaluated_file_id"), rs.getString("result_status"),
                rs.getString("process_id"), rs.getString("process_status"), rs.getString("current_step"),
                (Integer) rs.getObject("questions_completed"), (Integer) rs.getObject("questions_total"),
                rs.getString("error_message"), rs.getBigDecimal("quoted_credits"), instant(rs, "process_created_at"),
                instant(rs, "process_started_at"), instant(rs, "process_completed_at"), rs.getString("lane"),
                (Integer) rs.getObject("page_count"), rs.getString("process_institute_id"), rs.getLong("runs"),
                rs.getBoolean("any_failed"), rs.getBoolean("question_needs_review"),
                (Integer) rs.getObject("rubric_version"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }
}
