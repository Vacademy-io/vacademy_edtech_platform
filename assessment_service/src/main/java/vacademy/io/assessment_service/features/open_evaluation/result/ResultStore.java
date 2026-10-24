package vacademy.io.assessment_service.features.open_evaluation.result;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Raw reads behind the results read model (spec 7.8) and the review writes that the JPA
 * entities do not map ({@code ai_question_evaluation.review_meta}, V54).
 */
@Repository
public class ResultStore {

    /** One AI verdict row (newest per question of a run). */
    public record AiRow(String questionId, String status, BigDecimal marksAwarded, BigDecimal maxMarks,
            String feedback, String extractedAnswer, String resultJson, boolean edited, String editedBy,
            Instant editedAt, String reviewMetaJson, Integer rubricVersion) {
    }

    /** One {@code question_wise_marks} row of the attempt. */
    public record MarksRow(String questionId, double marks, String marksSource, String status) {
    }

    private final NamedParameterJdbcTemplate jdbc;

    @Autowired
    public ResultStore(JdbcTemplate jdbcTemplate) {
        this.jdbc = new NamedParameterJdbcTemplate(jdbcTemplate);
    }

    ResultStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** question_id → newest row of the run (one per question since V53; newest wins on legacy duplicates). */
    public Map<String, AiRow> aiRows(String processId) {
        Map<String, AiRow> out = new LinkedHashMap<>();
        if (processId == null) {
            return out;
        }
        jdbc.query("""
                SELECT question_id, status, marks_awarded, max_marks, feedback, extracted_answer, evaluation_result_json,
                       COALESCE(is_edited, FALSE) AS is_edited, edited_by, edited_at, review_meta::text AS review_meta,
                       rubric_version
                FROM ai_question_evaluation WHERE evaluation_process_id = :p
                ORDER BY created_at DESC, id
                """, new MapSqlParameterSource("p", processId), rs -> {
            String qid = rs.getString("question_id");
            if (!out.containsKey(qid)) {
                Timestamp edited = rs.getTimestamp("edited_at");
                out.put(qid, new AiRow(qid, rs.getString("status"), rs.getBigDecimal("marks_awarded"),
                        rs.getBigDecimal("max_marks"), rs.getString("feedback"), rs.getString("extracted_answer"),
                        rs.getString("evaluation_result_json"), rs.getBoolean("is_edited"), rs.getString("edited_by"),
                        edited == null ? null : edited.toInstant(), rs.getString("review_meta"),
                        (Integer) rs.getObject("rubric_version")));
            }
        });
        return out;
    }

    /** question_id → marks row of the attempt (newest wins). */
    public Map<String, MarksRow> marks(String attemptId) {
        Map<String, MarksRow> out = new LinkedHashMap<>();
        jdbc.query("""
                SELECT question_id, marks, marks_source, status FROM question_wise_marks
                WHERE attempt_id = :a ORDER BY created_at DESC, id
                """, new MapSqlParameterSource("a", attemptId), rs -> {
            out.putIfAbsent(rs.getString("question_id"), new MarksRow(rs.getString("question_id"), rs.getDouble("marks"),
                    rs.getString("marks_source"), rs.getString("status")));
        });
        return out;
    }

    /** Merges keys into one question's review_meta (jsonb {@code ||}; existing keys not sent are kept). */
    public int mergeReviewMeta(String processId, String questionId, String patchJson) {
        return jdbc.update("""
                UPDATE ai_question_evaluation SET review_meta = COALESCE(review_meta, '{}'::jsonb) || CAST(:patch AS jsonb)
                WHERE evaluation_process_id = :p AND question_id = :q
                """, new MapSqlParameterSource().addValue("p", processId).addValue("q", questionId)
                .addValue("patch", patchJson));
    }

    /** Merges keys into every question row of a run (approve). */
    public int mergeReviewMetaAll(String processId, String patchJson) {
        return jdbc.update("""
                UPDATE ai_question_evaluation SET review_meta = COALESCE(review_meta, '{}'::jsonb) || CAST(:patch AS jsonb)
                WHERE evaluation_process_id = :p
                """, new MapSqlParameterSource().addValue("p", processId).addValue("patch", patchJson));
    }

    /** Edited rows of a run, to carry into a re-run when {@code keep_reviewed} (spec 7.6). */
    public List<Map<String, Object>> editedRows(String processId) {
        if (processId == null) {
            return List.of();
        }
        return new ArrayList<>(jdbc.queryForList("""
                SELECT question_id, question_wise_marks_id, question_number, evaluation_result_json, marks_awarded,
                       max_marks, feedback, extracted_answer, status, rubric_version, edited_by, edited_at,
                       review_meta::text AS review_meta
                FROM ai_question_evaluation
                WHERE evaluation_process_id = :p AND COALESCE(is_edited, FALSE)
                """, new MapSqlParameterSource("p", processId)));
    }

    /** Copies one edited row onto a new run; the dispatcher keeps it and skips its callback. */
    public void insertCarriedRow(String id, String processId, Map<String, Object> row) {
        jdbc.update("""
                INSERT INTO ai_question_evaluation (id, evaluation_process_id, question_id, question_wise_marks_id,
                    question_number, evaluation_result_json, marks_awarded, max_marks, feedback, extracted_answer,
                    status, rubric_version, is_edited, edited_by, edited_at, review_meta, completed_at, created_at,
                    updated_at)
                VALUES (:id, :p, :q, :qwm, :num, :json, :awarded, :max, :feedback, :extracted, :status, :rubric, TRUE,
                        :editedBy, :editedAt, CAST(:meta AS jsonb), now(), now(), now())
                """, new MapSqlParameterSource()
                .addValue("id", id)
                .addValue("p", processId)
                .addValue("q", row.get("question_id"))
                .addValue("qwm", row.get("question_wise_marks_id"))
                .addValue("num", row.get("question_number"))
                .addValue("json", row.get("evaluation_result_json"))
                .addValue("awarded", row.get("marks_awarded"))
                .addValue("max", row.get("max_marks"))
                .addValue("feedback", row.get("feedback"))
                .addValue("extracted", row.get("extracted_answer"))
                .addValue("status", row.get("status"))
                .addValue("rubric", row.get("rubric_version"))
                .addValue("editedBy", row.get("edited_by"))
                .addValue("editedAt", row.get("edited_at"))
                .addValue("meta", row.get("review_meta")));
    }
}
