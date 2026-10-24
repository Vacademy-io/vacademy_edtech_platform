package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AiEvaluationTriggerRequest;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockedException;

/**
 * A bulk AI check on a partner-API exam that includes a released (finalized) attempt is
 * refused before anything is queued: no attempt of the batch is left running and billed
 * behind the 409.
 */
class AiEvaluationServiceTriggerLockTest {

        private AiEvaluationProcessRepository processes;
        private AiEvaluationAsyncService async;
        private EvaluationAccessValidator access;
        private AiEvaluationService service;

        @BeforeEach
        void setUp() {
                processes = mock(AiEvaluationProcessRepository.class);
                async = mock(AiEvaluationAsyncService.class);
                access = mock(EvaluationAccessValidator.class);
                QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                service = new AiEvaluationService(processes, async, mock(AiEvaluationCancellationService.class),
                                access, mappings, mock(QuestionWiseMarksRepository.class), mock(TypedAnswerEvaluation.class),
                                mock(vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.class));
                ReflectionTestUtils.setField(service, "resultLockGuard", new ResultLockGuard());
        }

        private StudentAttempt attempt(String id, String releaseStatus) {
                Assessment exam = new Assessment();
                exam.setId("exam-1");
                exam.setSource("API");
                AssessmentUserRegistration registration = new AssessmentUserRegistration();
                registration.setAssessment(exam);
                StudentAttempt a = new StudentAttempt();
                a.setId(id);
                a.setReportReleaseStatus(releaseStatus);
                // registration left null on purpose: the gradable-question check then has
                // nothing to look up, and the API-exam lock reads it through the attempt.
                a.setRegistration("RELEASED".equals(releaseStatus) ? registration : null);
                return a;
        }

        @Test
        void a_released_attempt_later_in_the_batch_stops_the_whole_batch_before_queueing() {
                when(access.requireAttemptAccess(any(), eq("inst-1"), eq("att-1"))).thenReturn(attempt("att-1", "PENDING"));
                when(access.requireAttemptAccess(any(), eq("inst-1"), eq("att-2"))).thenReturn(attempt("att-2", "RELEASED"));

                AiEvaluationTriggerRequest request = new AiEvaluationTriggerRequest();
                request.setAttemptIds(List.of("att-1", "att-2"));

                // Both refusals are 409s for a released result: the engine's own release check
                // (T0.33) runs before the API-exam lock since the queue work merged.
                assertThatThrownBy(() -> service.triggerEvaluation(request, null, "inst-1"))
                                .isInstanceOfAny(ResultLockedException.class, ResultReleasedException.class);

                verify(processes, never()).findActiveByAttemptId(anyString(), anyList());
                verify(processes, never()).save(any());
                verifyNoInteractions(async);
        }
}
