package vacademy.io.assessment_service.features.open_evaluation.rubric;

import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Partner rubric ⇄ the engine's {@code CriteriaRubric} ({@code ai_service/app/schemas/copy_check.py:184-195};
 * spec 7.4 table):
 * <pre>
 * criteria[].name      ⇄ rubric[].criteria_name
 * criteria[].marks     ⇄ rubric[].max_marks
 * criteria[].keywords  ⇄ rubric[].keywords
 * criteria[].guidance  ⇄ rubric[].evaluation_guidelines
 * partial_marking      ⇄ partial_marking_enabled
 * instructions         ⇄ evaluation_instructions
 * question max_marks   ⇄ max_marks
 * </pre>
 * Rubric text goes to ai_service as plain text: it is grading-prompt data, never rendered
 * as markup on the dashboard (criterion names cannot contain angle brackets, see
 * {@link RubricRules}).
 */
public final class RubricMapper {

    private RubricMapper() {
    }

    public static Map<String, Object> toEngine(ExamInputs.RubricInput rubric, BigDecimal questionMaxMarks) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("max_marks", questionMaxMarks == null ? null : questionMaxMarks.doubleValue());
        out.put("partial_marking_enabled", rubric.getPartialMarking() == null || rubric.getPartialMarking());
        out.put("evaluation_instructions", rubric.getInstructions() == null ? "" : rubric.getInstructions().trim());
        List<Map<String, Object>> items = new ArrayList<>();
        for (ExamInputs.CriterionInput c : rubric.getCriteria()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("criteria_name", c.getName().trim());
            item.put("max_marks", c.getMarks().doubleValue());
            item.put("keywords", c.getKeywords() == null ? List.of()
                    : c.getKeywords().stream().map(String::trim).toList());
            item.put("evaluation_guidelines", c.getGuidance() == null ? "" : c.getGuidance().trim());
            items.add(item);
        }
        out.put("rubric", items);
        return out;
    }

    /** Engine rubric (as stored by ai_service) back to the partner shape; null stays null. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> toPartner(Map<String, Object> engine) {
        if (engine == null) {
            return null;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        Object partial = engine.get("partial_marking_enabled");
        out.put("partial_marking", partial == null || Boolean.TRUE.equals(partial));
        Object instructions = engine.get("evaluation_instructions");
        if (instructions instanceof String s && !s.isBlank()) {
            out.put("instructions", s);
        }
        List<Map<String, Object>> criteria = new ArrayList<>();
        Object items = engine.get("rubric");
        if (items instanceof List<?> list) {
            for (Object o : list) {
                if (!(o instanceof Map<?, ?> raw)) {
                    continue;
                }
                Map<String, Object> m = (Map<String, Object>) raw;
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("name", m.get("criteria_name"));
                c.put("marks", m.get("max_marks"));
                c.put("keywords", m.get("keywords") == null ? List.of() : m.get("keywords"));
                c.put("guidance", m.get("evaluation_guidelines") == null ? "" : m.get("evaluation_guidelines"));
                criteria.add(c);
            }
        }
        out.put("criteria", criteria);
        return out;
    }
}
