package vacademy.io.assessment_service.features.submission_review.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read queries of the submission review (paper, marks rows, AI runs, submitted attempts).
 * Plain JDBC: these are projections across several tables, read once per request, and a
 * mock of this class is all a unit test needs.
 */
@Component
public class SubmissionReviewStore {

    private final NamedParameterJdbcTemplate jdbc;

    @Autowired
    public SubmissionReviewStore(JdbcTemplate jdbcTemplate) {
        this.jdbc = new NamedParameterJdbcTemplate(jdbcTemplate);
    }

    SubmissionReviewStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Live mappings of live sections, in paper order; a duplicated mapping keeps its newest row. */
    public Review.Paper paper(String assessmentId) {
        String sql = """
                SELECT s.id AS section_id, s.name AS section_name, s.section_order, s.marks_per_question,
                       m.question_id, m.question_order, q.question_type, m.marking_json, q.auto_evaluation_json,
                       m.created_at
                FROM question_assessment_section_mapping m
                JOIN section s ON s.id = m.section_id
                JOIN question q ON q.id = m.question_id
                WHERE s.assessment_id = :a
                  AND COALESCE(s.status, '') <> 'DELETED'
                  AND COALESCE(m.status, '') <> 'DELETED'
                ORDER BY s.section_order NULLS LAST, s.id, m.question_order NULLS LAST, m.created_at
                """;
        Map<String, Object[]> byKey = new LinkedHashMap<>();
        jdbc.query(sql, new MapSqlParameterSource("a", assessmentId), rs -> {
            String key = rs.getString("section_id") + ":" + rs.getString("question_id");
            Object[] row = new Object[]{rs.getString("section_id"), rs.getString("section_name"),
                    intOr(rs, "section_order", 0), dbl(rs, "marks_per_question"), rs.getString("question_id"),
                    intOr(rs, "question_order", 0), rs.getString("question_type"), rs.getString("marking_json"),
                    rs.getString("auto_evaluation_json")};
            Object[] previous = byKey.get(key);
            // Same key twice: keep the paper position of the first, the scheme of the newest.
            if (previous != null) {
                row[2] = previous[2];
                row[5] = previous[5];
            }
            byKey.put(key, row);
        });
        List<Review.PaperKey> keys = new ArrayList<>();
        int number = 0;
        for (Object[] r : byKey.values()) {
            number++;
            keys.add(new Review.PaperKey((String) r[0], (String) r[1], (Integer) r[2], (Double) r[3], (String) r[4],
                    (Integer) r[5], number, (String) r[6], (String) r[7], (String) r[8]));
        }
        return new Review.Paper(assessmentId, keys);
    }

    /**
     * Marks rows of the attempts. response_json only for the rows whose state is derived from
     * the answer (legacy written rows still PENDING), so a 150-question attempt stays light.
     */
    public List<Review.MarkRow> rows(Collection<String> attemptIds) {
        if (attemptIds == null || attemptIds.isEmpty()) return List.of();
        if (attemptIds.size() > MAX_IN) {
            throw new IllegalArgumentException("Use rowsOfAssessment for more than " + MAX_IN + " attempts");
        }
        return rowsWhere("qwm.attempt_id IN (:ids)", new MapSqlParameterSource("ids", attemptIds));
    }

    /** Every marks row of an assessment (the list counts of a large test: no id list). */
    public List<Review.MarkRow> rowsOfAssessment(String assessmentId) {
        return rowsWhere("qwm.assessment_id = :a", new MapSqlParameterSource("a", assessmentId));
    }

    /** Above this many ids a query is made per assessment instead (JDBC caps bind parameters). */
    public static final int MAX_IN = 1000;

    private List<Review.MarkRow> rowsWhere(String where, MapSqlParameterSource params) {
        String sql = """
                SELECT qwm.id, qwm.attempt_id, qwm.section_id, qwm.question_id, qwm.marks, qwm.status,
                       qwm.marks_source, qwm.mark_state, qwm.revision, qwm.max_marks, qwm.marked_by, qwm.marked_at,
                       (qwm.evaluator_feedback IS NOT NULL AND qwm.evaluator_feedback <> '') AS has_feedback,
                       qwm.answer_pages, qwm.ai_question_evaluation_id, qwm.created_at,
                       CASE WHEN qwm.marks_source IS NULL AND qwm.mark_state IS NULL AND qwm.status = 'PENDING'
                                 AND q.question_type IN ('CBE_RESPONSE', 'LONG_ANSWER')
                            THEN qwm.response_json END AS response_json
                FROM question_wise_marks qwm
                LEFT JOIN question q ON q.id = qwm.question_id
                WHERE """ + " " + where;
        return jdbc.query(sql, params, (rs, i) -> new Review.MarkRow(
                rs.getString("id"), rs.getString("attempt_id"), rs.getString("section_id"),
                rs.getString("question_id"), rs.getDouble("marks"), rs.getString("status"),
                rs.getString("marks_source"), rs.getString("mark_state"), intOr(rs, "revision", 0),
                dbl(rs, "max_marks"), rs.getString("marked_by"), date(rs, "marked_at"),
                rs.getBoolean("has_feedback"), rs.getString("answer_pages"),
                rs.getString("ai_question_evaluation_id"), date(rs, "created_at"), rs.getString("response_json")));
    }

    /** Per attempt: its active run, its newest run, its newest finished run and that run's per-question status. */
    public Map<String, Review.RunInfo> runs(Collection<String> attemptIds) {
        if (attemptIds == null || attemptIds.isEmpty()) return new HashMap<>();
        if (attemptIds.size() > MAX_IN) {
            throw new IllegalArgumentException("Use runsOfAssessment for more than " + MAX_IN + " attempts");
        }
        return runsWhere("attempt_id IN (:ids)", new MapSqlParameterSource("ids", attemptIds));
    }

    /** The AI runs of every attempt of an assessment. */
    public Map<String, Review.RunInfo> runsOfAssessment(String assessmentId) {
        return runsWhere("assessment_id = :a", new MapSqlParameterSource("a", assessmentId));
    }

    private Map<String, Review.RunInfo> runsWhere(String where, MapSqlParameterSource params) {
        Map<String, Review.RunInfo> out = new HashMap<>();
        String sql = """
                SELECT id, attempt_id, status, lane, triggered_by, api_key_id, error_message,
                       questions_completed, questions_total, page_count, started_at, created_at
                FROM ai_evaluation_process
                WHERE """ + " " + where + " " + """

                ORDER BY created_at DESC
                """;
        Map<String, List<Review.ProcessInfo>> byAttempt = new LinkedHashMap<>();
        jdbc.query(sql, params, rs -> {
            byAttempt.computeIfAbsent(rs.getString("attempt_id"), k -> new ArrayList<>()).add(new Review.ProcessInfo(
                    rs.getString("id"), rs.getString("status"), rs.getString("lane"), rs.getString("triggered_by"),
                    rs.getString("api_key_id"), rs.getString("error_message"), intOrNull(rs, "questions_completed"),
                    intOrNull(rs, "questions_total"), intOrNull(rs, "page_count"), date(rs, "started_at"),
                    date(rs, "created_at")));
        });
        Map<String, String> terminalByAttempt = new HashMap<>();
        Map<String, Review.ProcessInfo[]> picked = new HashMap<>();
        byAttempt.forEach((attemptId, list) -> {
            Review.ProcessInfo active = null;
            Review.ProcessInfo terminal = null;
            for (Review.ProcessInfo p : list) {
                String st = p.status() == null ? "" : p.status().toUpperCase();
                if (active == null && AiEvaluationStatusEnum.ACTIVE.contains(st)) active = p;
                if (terminal == null && AiEvaluationStatusEnum.TERMINAL.contains(st)) terminal = p;
            }
            picked.put(attemptId, new Review.ProcessInfo[]{active, list.get(0), terminal});
            if (terminal != null) terminalByAttempt.put(terminal.id(), attemptId);
        });
        Map<String, Map<String, String>> questionStatus = new HashMap<>();
        if (!terminalByAttempt.isEmpty()) {
            String q = """
                    SELECT evaluation_process_id, question_id, status
                    FROM ai_question_evaluation
                    WHERE evaluation_process_id IN (:pids)
                    ORDER BY created_at
                    """;
            List<String> pids = new ArrayList<>(terminalByAttempt.keySet());
            for (int from = 0; from < pids.size(); from += MAX_IN) {
                List<String> chunk = pids.subList(from, Math.min(pids.size(), from + MAX_IN));
                jdbc.query(q, new MapSqlParameterSource("pids", chunk), rs -> {
                    questionStatus.computeIfAbsent(rs.getString("evaluation_process_id"), k -> new HashMap<>())
                            .put(rs.getString("question_id"), rs.getString("status"));
                });
            }
        }
        picked.forEach((attemptId, p) -> out.put(attemptId, new Review.RunInfo(p[0], p[1], p[2],
                p[2] == null ? Map.of() : questionStatus.getOrDefault(p[2].id(), Map.of()))));
        return out;
    }

    public Review.RunInfo runs(String attemptId) {
        return runs(List.of(attemptId)).getOrDefault(attemptId, Review.RunInfo.NONE);
    }

    /** The release-relevant columns of an attempt (including the read-only V74 ones). */
    public record AttemptState(String id, String status, String reportReleaseStatus, Date reportLastReleaseDate,
                               Double totalMarks, String resultStatus, int marksRevision, Integer notifiedRevision,
                               Date resultRevisedAt, boolean releaseWhenMarked, String evaluatorIds,
                               Date submitTime, Date withheldAt) {
        /** Without the "hidden by a teacher" date (tests and callers that do not need it). */
        public AttemptState(String id, String status, String reportReleaseStatus, Date reportLastReleaseDate,
                            Double totalMarks, String resultStatus, int marksRevision, Integer notifiedRevision,
                            Date resultRevisedAt, boolean releaseWhenMarked, String evaluatorIds, Date submitTime) {
            this(id, status, reportReleaseStatus, reportLastReleaseDate, totalMarks, resultStatus, marksRevision,
                    notifiedRevision, resultRevisedAt, releaseWhenMarked, evaluatorIds, submitTime, null);
        }

        public boolean released() {
            return "RELEASED".equals(reportReleaseStatus);
        }

        /** The release token the dashboard echoes back as expected_release. */
        public String token() {
            return token(reportReleaseStatus, reportLastReleaseDate);
        }

        /** Released and changed since the learner was last told (W1 "Released, changed"). */
        public boolean changedSinceRelease() {
            return released() && resultRevisedAt != null
                    && (notifiedRevision == null || marksRevision > notifiedRevision);
        }

        /** A teacher pressed "Hide result again": only a teacher's release shows it again. */
        public boolean withheld() {
            return !released() && withheldAt != null;
        }

        public static String token(String releaseStatus, Date releaseDate) {
            return (releaseStatus == null ? "NONE" : releaseStatus) + "|" + (releaseDate == null ? 0 : releaseDate.getTime());
        }
    }

    private static final String ATTEMPT_COLUMNS = """
            sa.id, sa.status, sa.report_release_status, sa.report_last_release_date, sa.total_marks,
            sa.result_status, sa.marks_revision, sa.notified_revision, sa.result_revised_at,
            sa.release_when_marked, sa.comma_separated_evaluator_user_ids, sa.submit_time, sa.result_withheld_at
            """;

    /** Submitted attempts of the assessment (ENDED or COPY_CHECK), oldest submission first. */
    public List<AttemptState> submittedAttempts(String assessmentId) {
        String sql = "SELECT " + ATTEMPT_COLUMNS + """
                FROM student_attempt sa
                JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                WHERE aur.assessment_id = :a
                  AND sa.status IN ('ENDED', 'COPY_CHECK')
                  AND COALESCE(aur.status, '') <> 'DELETED'
                ORDER BY sa.submit_time NULLS LAST, sa.id
                """;
        return jdbc.query(sql, new MapSqlParameterSource("a", assessmentId), (rs, i) -> attemptState(rs));
    }

    /** Every attempt of the assessment that is not deleted (release-check "all"). */
    public List<AttemptState> allAttempts(String assessmentId) {
        String sql = "SELECT " + ATTEMPT_COLUMNS + """
                FROM student_attempt sa
                JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                WHERE aur.assessment_id = :a
                  AND COALESCE(sa.status, '') <> 'DELETED'
                ORDER BY sa.submit_time NULLS LAST, sa.id
                """;
        return jdbc.query(sql, new MapSqlParameterSource("a", assessmentId), (rs, i) -> attemptState(rs));
    }

    /** The given attempts, only those on the assessment. */
    public List<AttemptState> attempts(String assessmentId, Collection<String> attemptIds) {
        if (attemptIds == null || attemptIds.isEmpty()) return List.of();
        String sql = "SELECT " + ATTEMPT_COLUMNS + """
                FROM student_attempt sa
                JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                WHERE aur.assessment_id = :a AND sa.id IN (:ids)
                ORDER BY sa.submit_time NULLS LAST, sa.id
                """;
        return jdbc.query(sql, new MapSqlParameterSource("a", assessmentId).addValue("ids", attemptIds),
                (rs, i) -> attemptState(rs));
    }

    public AttemptState attempt(String attemptId) {
        String sql = "SELECT " + ATTEMPT_COLUMNS + " FROM student_attempt sa WHERE sa.id = :id";
        List<AttemptState> rows = jdbc.query(sql, new MapSqlParameterSource("id", attemptId),
                (rs, i) -> attemptState(rs));
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static AttemptState attemptState(ResultSet rs) throws SQLException {
        return new AttemptState(rs.getString("id"), rs.getString("status"), rs.getString("report_release_status"),
                date(rs, "report_last_release_date"), dbl(rs, "total_marks"), rs.getString("result_status"),
                intOr(rs, "marks_revision", 0), intOrNull(rs, "notified_revision"), date(rs, "result_revised_at"),
                Boolean.TRUE.equals(rs.getObject("release_when_marked")),
                rs.getString("comma_separated_evaluator_user_ids"), date(rs, "submit_time"),
                date(rs, "result_withheld_at"));
    }

    private static Date date(ResultSet rs, String col) throws SQLException {
        Timestamp t = rs.getTimestamp(col);
        return t == null ? null : new Date(t.getTime());
    }

    private static Double dbl(ResultSet rs, String col) throws SQLException {
        Object o = rs.getObject(col);
        return o == null ? null : ((Number) o).doubleValue();
    }

    private static int intOr(ResultSet rs, String col, int dflt) throws SQLException {
        Object o = rs.getObject(col);
        return o == null ? dflt : ((Number) o).intValue();
    }

    private static Integer intOrNull(ResultSet rs, String col) throws SQLException {
        Object o = rs.getObject(col);
        return o == null ? null : ((Number) o).intValue();
    }
}
