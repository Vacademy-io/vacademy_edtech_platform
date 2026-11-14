package vacademy.io.assessment_service.features.assessment.omr.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The assessment's paper as authored, in one query: sections in their order, the
 * questions of each section in their order, the options of each question in their
 * order ({@code option_order}, then creation time - the same order the dashboard and
 * the learner app show), and each question's correct option.
 */
@Component
@RequiredArgsConstructor
public class OmrPaperLoader {

    @PersistenceContext
    private EntityManager em;

    private final ObjectMapper objectMapper;

    public record PaperQuestion(String questionId, String sectionId, String questionType,
                                List<String> optionIds, List<String> correctOptionIds) {
    }

    // No semicolons in this text: Hibernate splits native queries at them.
    private static final String SQL = """
            SELECT qasm.question_id, qasm.section_id, q.question_type, q.auto_evaluation_json, o.id AS option_id
            FROM question_assessment_section_mapping qasm
            JOIN section s ON s.id = qasm.section_id
            JOIN question q ON q.id = qasm.question_id
            LEFT JOIN "option" o ON o.question_id = q.id
            WHERE s.assessment_id = :assessmentId
              AND COALESCE(s.status, 'ACTIVE') <> 'DELETED'
              AND COALESCE(qasm.status, 'ACTIVE') <> 'DELETED'
            ORDER BY s.section_order NULLS LAST, s.id,
                     qasm.question_order NULLS LAST, qasm.question_id,
                     o.option_order NULLS LAST, o.created_on, o.id
            """;

    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public List<PaperQuestion> load(String assessmentId) {
        List<Object[]> rows = em.createNativeQuery(SQL).setParameter("assessmentId", assessmentId).getResultList();
        Map<String, PaperQuestion> byKey = new LinkedHashMap<>();
        for (Object[] r : rows) {
            String questionId = (String) r[0];
            String sectionId = (String) r[1];
            String key = sectionId + "|" + questionId;
            PaperQuestion q = byKey.get(key);
            if (q == null) {
                q = new PaperQuestion(questionId, sectionId, (String) r[2], new ArrayList<>(), correctOptionIds((String) r[3]));
                byKey.put(key, q);
            }
            if (r[4] != null && !q.optionIds().contains((String) r[4])) {
                q.optionIds().add((String) r[4]);
            }
        }
        return new ArrayList<>(byKey.values());
    }

    private List<String> correctOptionIds(String autoEvaluationJson) {
        List<String> out = new ArrayList<>();
        if (autoEvaluationJson == null || autoEvaluationJson.isBlank()) return out;
        try {
            JsonNode ids = objectMapper.readTree(autoEvaluationJson).path("data").path("correctOptionIds");
            if (ids.isArray()) ids.forEach(n -> out.add(n.asText()));
        } catch (Exception ignored) {
            // an unreadable key is reported as "no correct option" by the validation
        }
        return out;
    }
}
