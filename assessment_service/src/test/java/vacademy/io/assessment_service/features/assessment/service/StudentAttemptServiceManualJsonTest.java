package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.learner_assessment.dto.status_json.manual.LearnerManualAttemptDataDto;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The learner app keeps on-screen CBE / CODING answers in the manual (PDF upload) submit
 * payload as {@code sections[].questions[].responseData}. The manual DTOs do not model it,
 * and that must not make the final submit fail with "Unrecognized field".
 */
class StudentAttemptServiceManualJsonTest {

    @Test
    void aManualSubmitCarryingResponseDataIsAccepted() {
        String json = """
                {"attemptId":"att-1","clientLastSync":"2026-11-10T10:00:00Z","fileId":"f-1","setId":"s-1",
                 "assessment":{"assessmentId":"a-1","entireTestDurationLeftInSeconds":10,"status":"LIVE",
                   "timeElapsedInSeconds":5,"tabSwitchCount":0,"somethingNew":true},
                 "sections":[{"sectionId":"sec-1","sectionDurationLeftInSeconds":0,"timeElapsedInSeconds":5,
                   "questions":[{"questionId":"q-1","isMarkedForReview":false,"isVisited":true,
                     "questionDurationLeftInSeconds":0,"timeTakenInSeconds":5,
                     "responseData":{"type":"CBE_RESPONSE","answer":{"parts":{"p1":{"kind":"DOCUMENT","html":"<p>x</p>"}}}}}]}]}
                """;

        LearnerManualAttemptDataDto dto = new StudentAttemptService().validateAndCreateManualAttemptJsonObject(json);

        assertThat(dto.getFileId()).isEqualTo("f-1");
        assertThat(dto.getSections()).hasSize(1);
        assertThat(dto.getSections().get(0).getQuestions().get(0).getQuestionId()).isEqualTo("q-1");
        assertThat(dto.getAssessment().getAssessmentId()).isEqualTo("a-1");
    }
}
