package vacademy.io.assessment_service.features.open_evaluation.candidate;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.support.Paging;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * {@code api_candidate} (V54): candidates of an institute, addressed by the partner's own
 * {@code external_id} and reused across exams, plus their registrations on exams
 * ({@code assessment_user_registration.user_id = 'apic_' || api_candidate.id}).
 */
@Repository
public class ApiCandidateStore {

    public static final String USER_ID_PREFIX = "apic_";

    public record CandidateRow(String id, String instituteId, String externalId, String name, String rollNumber,
            String sectionOrClass, String metadataJson, Instant createdAt, Instant updatedAt) {
        public String userId() {
            return USER_ID_PREFIX + id;
        }
    }

    public record Upserted(String id, String externalId, boolean created) {
    }

    /** One registration of a candidate on an exam, with the latest live submission. */
    public record ExamCandidateRow(CandidateRow candidate, String registrationId, Instant registrationUpdatedAt,
            String submissionId, String processStatus, boolean anyQuestionFailed) {
    }

    private static final String COLUMNS =
            "c.id, c.institute_id, c.external_id, c.name, c.roll_number, c.section_or_class, c.metadata::text AS metadata, "
                    + "c.created_at, c.updated_at";

    private static final RowMapper<CandidateRow> ROW = ApiCandidateStore::map;

    private final NamedParameterJdbcTemplate jdbc;

    @Autowired
    public ApiCandidateStore(JdbcTemplate jdbcTemplate) {
        this.jdbc = new NamedParameterJdbcTemplate(jdbcTemplate);
    }

    ApiCandidateStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Upsert on {@code (institute_id, external_id)}: fields sent replace stored ones, fields
     * left out keep their value. {@code created} is true for a new row.
     */
    public Upserted upsert(String instituteId, String keyId, ExamInputs.CandidateInput c) {
        JsonNode metadata = c.getMetadata();
        Map<String, Object> row = jdbc.queryForMap("""
                INSERT INTO api_candidate (id, institute_id, external_id, name, roll_number, section_or_class, metadata,
                                           created_by_key_id, created_at, updated_at)
                VALUES (:id, :inst, :ext, :name, :roll, :cls, CAST(:meta AS jsonb), :key, now(), now())
                ON CONFLICT (institute_id, external_id) DO UPDATE SET
                    name = COALESCE(EXCLUDED.name, api_candidate.name),
                    roll_number = COALESCE(EXCLUDED.roll_number, api_candidate.roll_number),
                    section_or_class = COALESCE(EXCLUDED.section_or_class, api_candidate.section_or_class),
                    metadata = COALESCE(EXCLUDED.metadata, api_candidate.metadata),
                    updated_at = now()
                RETURNING id, (xmax = 0) AS created
                """, new MapSqlParameterSource()
                .addValue("id", UUID.randomUUID().toString())
                .addValue("inst", instituteId)
                .addValue("ext", c.getExternalId().trim())
                .addValue("name", trimOrNull(c.getName()))
                .addValue("roll", trimOrNull(c.getRollNumber()))
                .addValue("cls", trimOrNull(c.getSectionOrClass()))
                .addValue("meta", metadata == null || metadata.isNull() ? null : metadata.toString())
                .addValue("key", keyId));
        return new Upserted((String) row.get("id"), c.getExternalId().trim(), Boolean.TRUE.equals(row.get("created")));
    }

    public Optional<CandidateRow> findById(String instituteId, String id) {
        if (id == null) {
            return Optional.empty();
        }
        return jdbc.query("SELECT " + COLUMNS + " FROM api_candidate c WHERE c.institute_id = :inst AND c.id = :id",
                new MapSqlParameterSource().addValue("inst", instituteId).addValue("id", id), ROW).stream().findFirst();
    }

    public List<CandidateRow> findByIds(String instituteId, Collection<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return jdbc.query("SELECT " + COLUMNS + " FROM api_candidate c WHERE c.institute_id = :inst AND c.id IN (:ids)",
                new MapSqlParameterSource().addValue("inst", instituteId).addValue("ids", ids), ROW);
    }

    public List<CandidateRow> findByExternalIds(String instituteId, Collection<String> externalIds) {
        if (externalIds == null || externalIds.isEmpty()) {
            return List.of();
        }
        return jdbc.query("SELECT " + COLUMNS + " FROM api_candidate c WHERE c.institute_id = :inst "
                        + "AND c.external_id IN (:ext) ORDER BY c.external_id",
                new MapSqlParameterSource().addValue("inst", instituteId).addValue("ext", externalIds), ROW);
    }

    /** user_id → registration id of the given synthetic users on the exam. */
    public Map<String, String> registrations(String examId, String instituteId, Collection<String> userIds) {
        Map<String, String> out = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) {
            return out;
        }
        jdbc.query("""
                SELECT user_id, id FROM assessment_user_registration
                WHERE assessment_id = :exam AND institute_id = :inst AND user_id IN (:users)
                ORDER BY created_at
                """, new MapSqlParameterSource().addValue("exam", examId).addValue("inst", instituteId)
                .addValue("users", userIds), rs -> {
            out.putIfAbsent(rs.getString("user_id"), rs.getString("id"));
        });
        return out;
    }

    /** The candidate has a submission (any attempt, or a live API submission) on the exam. */
    public boolean hasSubmission(String examId, String candidateId) {
        Boolean exists = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM api_submission s
                               WHERE s.exam_id = :exam AND s.candidate_id = :cand AND s.status <> 'DELETED')
                    OR EXISTS (SELECT 1 FROM student_attempt sa
                               JOIN assessment_user_registration r ON r.id = sa.registration_id
                               WHERE r.assessment_id = :exam AND r.user_id = :user)
                """, new MapSqlParameterSource().addValue("exam", examId).addValue("cand", candidateId)
                .addValue("user", USER_ID_PREFIX + candidateId), Boolean.class);
        return Boolean.TRUE.equals(exists);
    }

    /**
     * One page of the exam's API candidates ordered by registration {@code (updated_at, id)},
     * each with its latest live submission and that submission's latest AI run.
     */
    public List<ExamCandidateRow> examCandidates(String examId, String instituteId, Instant updatedSince,
            Paging.Cursor after, int fetch) {
        StringBuilder sql = new StringBuilder("SELECT ").append(COLUMNS).append("""
                , r.id AS registration_id, r.updated_at AS registration_updated_at,
                  s.attempt_id AS submission_id, lp.status AS process_status, COALESCE(lp.any_failed, FALSE) AS any_failed
                FROM assessment_user_registration r
                JOIN api_candidate c ON r.user_id = 'apic_' || c.id AND c.institute_id = :inst
                LEFT JOIN LATERAL (
                    SELECT attempt_id FROM api_submission
                    WHERE exam_id = :exam AND candidate_id = c.id AND status = 'LIVE'
                    ORDER BY created_at DESC LIMIT 1
                ) s ON TRUE
                LEFT JOIN LATERAL (
                    SELECT p.status,
                           EXISTS (SELECT 1 FROM ai_question_evaluation q
                                   WHERE q.evaluation_process_id = p.id AND q.status = 'FAILED') AS any_failed
                    FROM ai_evaluation_process p WHERE p.attempt_id = s.attempt_id
                    ORDER BY p.created_at DESC LIMIT 1
                ) lp ON TRUE
                WHERE r.assessment_id = :exam AND r.institute_id = :inst
                """);
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("exam", examId).addValue("inst", instituteId)
                .addValue("fetch", fetch);
        if (updatedSince != null) {
            sql.append(" AND r.updated_at > :since");
            p.addValue("since", Timestamp.from(updatedSince));
        }
        if (after != null) {
            sql.append(" AND (r.updated_at, r.id) > (:afterTs, :afterId)");
            p.addValue("afterTs", Paging.timestamp(after)).addValue("afterId", after.id());
        }
        sql.append(" ORDER BY r.updated_at, r.id LIMIT :fetch");
        return jdbc.query(sql.toString(), p, (rs, i) -> new ExamCandidateRow(map(rs, i), rs.getString("registration_id"),
                instant(rs, "registration_updated_at"), rs.getString("submission_id"), rs.getString("process_status"),
                rs.getBoolean("any_failed")));
    }

    private static CandidateRow map(ResultSet rs, int i) throws SQLException {
        return new CandidateRow(rs.getString("id"), rs.getString("institute_id"), rs.getString("external_id"),
                rs.getString("name"), rs.getString("roll_number"), rs.getString("section_or_class"),
                rs.getString("metadata"), instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }

    private static String trimOrNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
