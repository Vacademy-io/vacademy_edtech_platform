package vacademy.io.assessment_service.features.open_evaluation.rubric;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class RubricRulesTest {

    @ParameterizedTest
    @ValueSource(strings = {"Award 1 mark for the formula.", "2 marks for the diagram", "half marks if partly right",
            "give 0.5 for units", "Deduct one for a missing unit", "1.5 pts for steps", "½ for the label",
            "full marks only when both parts are right"})
    void mark_figures_in_guidance_are_detected(String guidance) {
        assertThat(RubricRules.GUIDANCE_MARKS.matcher(guidance).find()).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"Mentions Article 356 and the 1994 S.R. Bommai judgment.",
            "Section 4 of the Act; credit each well-argued dimension.", "States energy is released.",
            "Two dimensions are enough for credit.", "Marks the structure clearly"})
    void ordinary_guidance_passes(String guidance) {
        assertThat(RubricRules.GUIDANCE_MARKS.matcher(guidance).find()).isFalse();
    }

    @Test
    void shape_problems_are_field_errors() {
        ExamInputs.RubricInput rubric = new ExamInputs.RubricInput();
        rubric.setCriteria(new ArrayList<>(List.of(
                new ExamInputs.CriterionInput("", BigDecimal.ONE, null, null),
                new ExamInputs.CriterionInput("<b>x</b>", BigDecimal.ZERO, List.of(""), null))));
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        RubricRules.checkShape(rubric, "q.rubric", errors);
        assertThat(errors).extracting(OpenApiException.FieldError::field).containsExactly(
                "q.rubric.criteria[0].name", "q.rubric.criteria[1].name", "q.rubric.criteria[1].marks",
                "q.rubric.criteria[1].keywords");

        errors.clear();
        RubricRules.checkShape(new ExamInputs.RubricInput(), "q.rubric", errors);
        assertThat(errors).extracting(OpenApiException.FieldError::code).containsExactly("required");
    }

    @Test
    void engine_criteria_total_reads_stored_rubrics() {
        Map<String, Object> engine = Map.of("rubric", List.of(Map.of("max_marks", 1.5), Map.of("max_marks", 2)));
        assertThat(RubricRules.engineCriteriaTotal(engine)).isEqualByComparingTo("3.5");
        assertThat(RubricRules.engineCriteriaTotal(Map.of("rubric", List.of()))).isNull();
        assertThat(RubricRules.engineCriteriaTotal(null)).isNull();
    }
}
