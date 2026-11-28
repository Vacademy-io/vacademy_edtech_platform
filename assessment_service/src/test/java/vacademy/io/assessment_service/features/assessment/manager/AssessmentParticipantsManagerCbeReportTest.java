package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.util.CbeConfigRedactorTest;

import static org.assertj.core.api.Assertions.assertThat;

/** The report shows a CBE solution only once that attempt's result is released. */
class AssessmentParticipantsManagerCbeReportTest {

    private static QuestionWiseMarks marks(String releaseStatus) {
        StudentAttempt attempt = new StudentAttempt();
        attempt.setReportReleaseStatus(releaseStatus);
        return QuestionWiseMarks.builder().studentAttempt(attempt).build();
    }

    private static Question question(String type, String json) {
        Question q = new Question();
        q.setQuestionType(type);
        q.setAutoEvaluationJson(json);
        return q;
    }

    @Test
    void cbeSolutionIsHiddenUntilReleased() {
        Question cbe = question("CBE_RESPONSE", CbeConfigRedactorTest.CBE);
        assertThat(AssessmentParticipantsManager.reportEvaluationJson(cbe, marks("PENDING")))
                .doesNotContain("markingScheme", "gradingNotes", "\"solution\"");
        assertThat(AssessmentParticipantsManager.reportEvaluationJson(cbe, marks(null)))
                .doesNotContain("markingScheme");
        assertThat(AssessmentParticipantsManager.reportEvaluationJson(cbe, null))
                .doesNotContain("markingScheme");
        assertThat(AssessmentParticipantsManager.reportEvaluationJson(cbe, marks("RELEASED")))
                .isSameAs(CbeConfigRedactorTest.CBE);
    }

    @Test
    void otherTypesAreUnchanged() {
        String mcq = "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"o1\"]}}";
        assertThat(AssessmentParticipantsManager.reportEvaluationJson(question("MCQS", mcq), marks("PENDING"))).isSameAs(mcq);
    }
}
