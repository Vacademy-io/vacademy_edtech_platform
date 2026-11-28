package vacademy.io.assessment_service.features.assessment.dto;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The staff preview shows a question's explanation (it was always empty); the DTO a learner
 * gets when starting an attempt never carries it.
 */
class AssessmentQuestionPreviewDtoTest {

    private static QuestionAssessmentSectionMapping mapping(Question q) {
        Section s = new Section();
        s.setId("s1");
        QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
        m.setQuestion(q);
        m.setSection(s);
        return m;
    }

    @Test
    void explanation_only_when_asked_for() {
        Question q = new Question();
        q.setId("q1");
        AssessmentRichTextData explanation = new AssessmentRichTextData();
        explanation.setContent("<p>Provision, application, conclusion</p>");
        q.setExplanationTextData(explanation);

        AssessmentQuestionPreviewDto dto = new AssessmentQuestionPreviewDto(q, mapping(q));
        assertThat(dto.getExplanation()).isNull();

        dto.fillExplanation(q);
        assertThat(dto.getExplanation().getContent()).isEqualTo("<p>Provision, application, conclusion</p>");
    }

    @Test
    void no_explanation_stays_null() {
        Question q = new Question();
        q.setId("q1");
        AssessmentQuestionPreviewDto dto = new AssessmentQuestionPreviewDto(q, mapping(q));
        dto.fillExplanation(q);
        assertThat(dto.getExplanation()).isNull();
    }
}
