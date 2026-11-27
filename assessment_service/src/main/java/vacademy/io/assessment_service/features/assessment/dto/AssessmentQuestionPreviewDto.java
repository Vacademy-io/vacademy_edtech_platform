package vacademy.io.assessment_service.features.assessment.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.question_core.dto.OptionDTO;
import vacademy.io.assessment_service.features.question_core.dto.OptionWithoutExplanationDTO;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.rich_text.dto.AssessmentRichTextDataDTO;

import java.util.ArrayList;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssessmentQuestionPreviewDto {
    private String questionId;
    private AssessmentRichTextDataDTO parentRichText;
    private AssessmentRichTextDataDTO question;
    private String sectionId;
    private Integer questionDuration;
    private Integer questionOrder;
    private String markingJson;
    private String evaluationJson;
    private String questionType;
    private String evaluationCriteriaJson;
    private String criteriaTemplateId;
    private List<OptionWithoutExplanationDTO> options = new ArrayList<>();
    private List<OptionDTO> optionsWithExplanation = new ArrayList<>();
    // The question's explanation (solution). Staff only - see fillExplanation.
    private AssessmentRichTextDataDTO explanation;

    public AssessmentQuestionPreviewDto(Question question,
            QuestionAssessmentSectionMapping questionAssessmentSectionMapping) {
        this.questionId = question.getId();
        this.question = question.getTextData() == null ? null : question.getTextData().toDTO();
        this.sectionId = questionAssessmentSectionMapping.getSection().getId();
        this.questionDuration = questionAssessmentSectionMapping.getQuestionDurationInMin();
        this.questionOrder = questionAssessmentSectionMapping.getQuestionOrder();
        this.markingJson = questionAssessmentSectionMapping.getMarkingJson();
        this.evaluationJson = question.getAutoEvaluationJson();
        this.questionType = question.getQuestionType();
        this.evaluationCriteriaJson = question.getEvaluationCriteriaJson();
        this.criteriaTemplateId = question.getCriteriaTemplateId();
        if (question.getParentRichText() != null) {
            this.parentRichText = question.getParentRichText().toDTO();
        }
    }

    public void fillOptionsOfQuestion(Question question) {
        List<OptionWithoutExplanationDTO> options = new ArrayList<>();
        for (Option option : question.getOptions()) {
            options.add(new OptionWithoutExplanationDTO(option));
        }
        this.options = options;
    }

    /**
     * The question's explanation, for the staff preview (it showed an empty Explanation for
     * every question). Never set in the constructor: learners get this DTO when they start an
     * attempt.
     */
    public void fillExplanation(Question question) {
        this.explanation = question.getExplanationTextData() == null ? null : question.getExplanationTextData().toDTO();
    }

    public void fillOptionsExplanationsOfQuestion(Question question) {
        List<OptionDTO> options = new ArrayList<>();
        for (Option option : question.getOptions()) {
            options.add(new OptionDTO(option));
        }
        this.optionsWithExplanation = options;
    }
}
