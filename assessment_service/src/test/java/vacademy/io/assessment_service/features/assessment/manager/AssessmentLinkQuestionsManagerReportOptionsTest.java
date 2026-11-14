package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.service.aireport.ReportOptions;
import vacademy.io.assessment_service.features.question_core.dto.OptionDTO;
import vacademy.io.assessment_service.features.rich_text.dto.AssessmentRichTextDataDTO;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The learner app reads questions-of-sections for its answer review. It carries the
 * answer key and option explanations, so an assessment that hides them in the
 * report must not send them either.
 */
class AssessmentLinkQuestionsManagerReportOptionsTest {

    @Test
    void hiddenCorrectAnswerDropsTheAnswerKey() {
        AssessmentQuestionPreviewDto dto = dto();
        AssessmentLinkQuestionsManager.applyLearnerReportOptions(dto, new ReportOptions(true, true, false, true));
        assertThat(dto.getEvaluationJson()).isNull();
        assertThat(dto.getOptionsWithExplanation().get(0).getExplanationText()).isNotNull();
    }

    @Test
    void hiddenExplanationDropsOptionExplanations() {
        AssessmentQuestionPreviewDto dto = dto();
        AssessmentLinkQuestionsManager.applyLearnerReportOptions(dto, new ReportOptions(true, true, true, false));
        assertThat(dto.getEvaluationJson()).isNotNull();
        assertThat(dto.getOptionsWithExplanation().get(0).getExplanationText()).isNull();
    }

    @Test
    void everythingShownLeavesItAlone() {
        AssessmentQuestionPreviewDto dto = dto();
        AssessmentLinkQuestionsManager.applyLearnerReportOptions(dto, ReportOptions.ALL);
        AssessmentLinkQuestionsManager.applyLearnerReportOptions(dto, null);
        assertThat(dto.getEvaluationJson()).isNotNull();
        assertThat(dto.getOptionsWithExplanation().get(0).getExplanationText()).isNotNull();
    }

    private static AssessmentQuestionPreviewDto dto() {
        AssessmentQuestionPreviewDto dto = new AssessmentQuestionPreviewDto();
        dto.setEvaluationJson("{\"data\":{\"correctOptionIds\":[\"o1\"]}}");
        OptionDTO option = new OptionDTO();
        option.setId("o1");
        option.setExplanationText(new AssessmentRichTextDataDTO());
        dto.setOptionsWithExplanation(new ArrayList<>(List.of(option)));
        return dto;
    }
}
