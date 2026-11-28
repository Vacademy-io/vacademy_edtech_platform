package vacademy.io.assessment_service.features.learner_assessment.manager;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.question_core.util.CbeConfigRedactorTest;

import static org.assertj.core.api.Assertions.assertThat;

/** The learner's question list (preview, start, restart) never carries a CBE solution. */
class LearnerCbeRedactionTest {

    @Test
    void cbeEvaluationJsonIsRedactedAndOtherTypesUntouched() {
        AssessmentQuestionPreviewDto cbe = new AssessmentQuestionPreviewDto();
        cbe.setQuestionType("CBE_RESPONSE");
        cbe.setEvaluationJson(CbeConfigRedactorTest.CBE);
        LearnerAssessmentAttemptStartManager.redactCbeSecrets(cbe);
        assertThat(cbe.getEvaluationJson()).contains("\"template\"", "promptHtml")
                .doesNotContain("markingScheme", "gradingNotes", "solutionFileId", "\"solution\"");

        String mcq = "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"o1\"]}}";
        AssessmentQuestionPreviewDto other = new AssessmentQuestionPreviewDto();
        other.setQuestionType("MCQS");
        other.setEvaluationJson(mcq);
        LearnerAssessmentAttemptStartManager.redactCbeSecrets(other);
        assertThat(other.getEvaluationJson()).isSameAs(mcq);
    }
}
