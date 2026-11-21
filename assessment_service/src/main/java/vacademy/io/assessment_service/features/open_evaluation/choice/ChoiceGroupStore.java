package vacademy.io.assessment_service.features.open_evaluation.choice;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * {@code assessment_choice_group} rows (V54): internal choice of one exam ("any 5 of 8",
 * "33 OR 33-OR"). {@code question_ids} is a JSON array of question ids, so relabelling a
 * question never breaks a group. Read by the grade-request builder (choice_groups +
 * paper_max, contract C4) and by the exam read model.
 */
@Repository
public class ChoiceGroupStore {

    /** One stored group. */
    public record ChoiceGroupRow(String id, String label, List<String> questionIds, int attempt, String policy,
            int displayOrder) {
    }

    private static final TypeReference<List<String>> ID_LIST = new TypeReference<>() {
    };

    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    @Autowired
    public ChoiceGroupStore(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this(new NamedParameterJdbcTemplate(jdbcTemplate), objectMapper);
    }

    ChoiceGroupStore(NamedParameterJdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public List<ChoiceGroupRow> list(String assessmentId) {
        return jdbc.query("""
                SELECT id, label, question_ids::text AS question_ids, attempt, policy, display_order
                FROM assessment_choice_group WHERE assessment_id = :id ORDER BY display_order, created_at, id
                """, new MapSqlParameterSource().addValue("id", assessmentId), (rs, i) -> new ChoiceGroupRow(
                rs.getString("id"), rs.getString("label"), parseIds(rs.getString("question_ids")),
                rs.getInt("attempt"), rs.getString("policy"), rs.getInt("display_order")));
    }

    /** Replaces every group of the exam (PUT semantics). */
    public void replace(String assessmentId, List<ChoiceGroupRow> groups) {
        jdbc.update("DELETE FROM assessment_choice_group WHERE assessment_id = :id",
                new MapSqlParameterSource().addValue("id", assessmentId));
        for (ChoiceGroupRow g : groups) {
            jdbc.update("""
                    INSERT INTO assessment_choice_group (id, assessment_id, label, question_ids, attempt, policy,
                                                         display_order, created_at, updated_at)
                    VALUES (:id, :assessmentId, :label, CAST(:questionIds AS jsonb), :attempt, :policy, :displayOrder,
                            now(), now())
                    """, new MapSqlParameterSource()
                    .addValue("id", g.id() == null ? UUID.randomUUID().toString() : g.id())
                    .addValue("assessmentId", assessmentId)
                    .addValue("label", g.label())
                    .addValue("questionIds", writeIds(g.questionIds()))
                    .addValue("attempt", g.attempt())
                    .addValue("policy", g.policy())
                    .addValue("displayOrder", g.displayOrder()));
        }
    }

    /** Whether a question belongs to any group of the exam. */
    public boolean isQuestionGrouped(String assessmentId, String questionId) {
        Boolean grouped = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM assessment_choice_group
                               WHERE assessment_id = :id AND question_ids @> CAST(:needle AS jsonb))
                """, new MapSqlParameterSource().addValue("id", assessmentId)
                .addValue("needle", writeIds(List.of(questionId))), Boolean.class);
        return Boolean.TRUE.equals(grouped);
    }

    private List<String> parseIds(String json) {
        try {
            return json == null ? List.of() : objectMapper.readValue(json, ID_LIST);
        } catch (Exception e) {
            return List.of();
        }
    }

    private String writeIds(List<String> ids) {
        try {
            return objectMapper.writeValueAsString(ids);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
