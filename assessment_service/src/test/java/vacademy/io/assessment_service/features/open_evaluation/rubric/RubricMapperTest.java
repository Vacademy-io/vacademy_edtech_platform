package vacademy.io.assessment_service.features.open_evaluation.rubric;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class RubricMapperTest {

    @Test
    void partner_rubric_maps_one_to_one_onto_the_engine_and_back() {
        ExamInputs.RubricInput in = new ExamInputs.RubricInput();
        in.setPartialMarking(false);
        in.setInstructions(" UPSC GS2. ");
        in.setCriteria(List.of(
                new ExamInputs.CriterionInput(" Introduction ", new BigDecimal("2"), List.of(" Article 356 "), "Defines the issue."),
                new ExamInputs.CriterionInput("Way forward", new BigDecimal("1.5"), null, null)));

        Map<String, Object> engine = RubricMapper.toEngine(in, new BigDecimal("3.5"));
        assertThat(engine).containsEntry("max_marks", 3.5).containsEntry("partial_marking_enabled", false)
                .containsEntry("evaluation_instructions", "UPSC GS2.");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) engine.get("rubric");
        assertThat(items.get(0)).containsEntry("criteria_name", "Introduction").containsEntry("max_marks", 2.0)
                .containsEntry("keywords", List.of("Article 356")).containsEntry("evaluation_guidelines", "Defines the issue.");
        assertThat(items.get(1)).containsEntry("keywords", List.of()).containsEntry("evaluation_guidelines", "");

        Map<String, Object> back = RubricMapper.toPartner(engine);
        assertThat(back).containsEntry("partial_marking", false).containsEntry("instructions", "UPSC GS2.");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> criteria = (List<Map<String, Object>>) back.get("criteria");
        assertThat(criteria).extracting(c -> c.get("name")).containsExactly("Introduction", "Way forward");
        assertThat(criteria.get(1)).containsEntry("marks", 1.5);
    }

    @Test
    void partial_marking_defaults_to_on() {
        ExamInputs.RubricInput in = new ExamInputs.RubricInput();
        in.setCriteria(List.of(new ExamInputs.CriterionInput("A", BigDecimal.ONE, null, null)));
        assertThat(RubricMapper.toEngine(in, BigDecimal.ONE)).containsEntry("partial_marking_enabled", true);
        assertThat(RubricMapper.toPartner(null)).isNull();
    }
}
