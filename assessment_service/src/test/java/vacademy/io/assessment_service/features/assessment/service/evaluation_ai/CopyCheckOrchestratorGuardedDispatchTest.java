package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.TransactionDefinition;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;

import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Gate G6: a claimed row is dispatched once, by its claimant, and the ai_service
 * call happens outside any transaction. A 429 is backpressure (back to the queue),
 * not a failure; a re-dispatch replaces the old tracking rows instead of adding a
 * second set, keeping a teacher's edits.
 */
class CopyCheckOrchestratorGuardedDispatchTest {

        private AiEvaluationProcessRepository processes;
        private AiServiceCopyCheckClient client;
        private AiQuestionEvaluationService tracking;
        private NoopTransactionManager tx;
        private CopyCheckOrchestratorService service;
        private AiEvaluationProcess process;
        private vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate credits;

        @BeforeEach
        void setUp() {
                processes = mock(AiEvaluationProcessRepository.class);
                QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
                client = mock(AiServiceCopyCheckClient.class);
                tracking = mock(AiQuestionEvaluationService.class);
                tx = new NoopTransactionManager();
                credits = mock(vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.class);
                QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                ObjectMapper json = new ObjectMapper();
                EvaluationUtilityService utility = new EvaluationUtilityService(json, mappings);
                TypedAnswerEvaluation typed = new TypedAnswerEvaluation(utility, mappings, marks, json);
                service = new CopyCheckOrchestratorService(processes, marks, tracking,
                                mock(EvaluationUtilityService.class), client, json,
                                mock(OptionRepository.class), mappings, typed, tx, credits, null);

                Assessment assessment = new Assessment();
                assessment.setId("assessment-1");
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("attempt-1");
                attempt.setAttemptData("{\"sections\":[]}");
                // Submitted long ago: never the typed hand-back case.
                attempt.setSubmitTime(new Date(System.currentTimeMillis() - 3_600_000L));
                process = new AiEvaluationProcess();
                process.setId("process-1");
                process.setStudentAttempt(attempt);
                process.setAssessment(assessment);
                process.setInstituteId("inst-1");
                process.setClaimedBy("pod-a");
                process.setStatus("DISPATCHED");
                when(processes.findById("process-1")).thenReturn(Optional.of(process));
                when(processes.save(any(AiEvaluationProcess.class))).thenAnswer(i -> i.getArgument(0));

                Question essay = new Question();
                essay.setId("essay");
                essay.setQuestionType("LONG_ANSWER");
                List<QuestionWiseMarks> rows = List.of(QuestionWiseMarks.builder().id("qwm-essay").question(essay)
                                .responseJson("{\"responseData\":{\"answer\":\"Dear Principal\"}}").build());
                when(marks.findByStudentAttemptId("attempt-1")).thenReturn(rows);
                when(marks.findByStudentAttemptIdWithQuestionDetails("attempt-1")).thenReturn(rows);
        }

        private void claimHolds() {
                when(processes.beginDispatch(eq("process-1"), eq("pod-a"), any())).thenAnswer(i -> {
                        process.setStatus("PROCESSING");
                        return 1;
                });
        }

        @Test
        void aRowNoLongerDispatchedUnderOurClaimIsNotSentAgain() {
                when(processes.beginDispatch(eq("process-1"), eq("pod-a"), any())).thenReturn(0);

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(client, never()).submitGrade(any());
                verify(tracking, never()).createQuestionEvaluation(any(), any(), anyInt());
                verify(tracking, never()).resetForRedispatch(any());
        }

        @Test
        void aRowCancelledBetweenTheGuardAndThePayloadIsNotSent() {
                when(processes.beginDispatch(eq("process-1"), eq("pod-a"), any())).thenAnswer(i -> {
                        process.setStatus("CANCELLED");
                        return 1;
                });

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(client, never()).submitGrade(any());
        }

        @Test
        void theAiServiceIsCalledOutsideAnyTransactionAndTheJobIdRecordedAfter() {
                claimHolds();
                when(client.submitGrade(any())).thenAnswer(i -> {
                        assertThat(tx.open).as("transactions open during the ai_service call").isZero();
                        return "job-1";
                });

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(processes).recordSubmitted(eq("process-1"), eq("job-1"), any());
                assertThat(tx.propagations).isNotEmpty()
                                .allMatch(p -> p == TransactionDefinition.PROPAGATION_REQUIRES_NEW);
                assertThat(process.getStatus()).isEqualTo("PROCESSING");
        }

        @Test
        void a429LeavesTheRowQueuedInsteadOfFailingIt() {
                claimHolds();
                when(client.submitGrade(any())).thenThrow(new AiServiceCopyCheckClient.AiServiceBusyException("busy"));

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(processes).requeueBusy(eq("process-1"), eq("pod-a"), any());
                verify(processes, never()).recordSubmitted(any(), any(), any());
                assertThat(process.getStatus()).isNotEqualTo("FAILED");
        }

        @Test
        void anyOtherSubmitFailureStillFailsTheProcess() {
                claimHolds();
                when(client.submitGrade(any())).thenThrow(new IllegalStateException("connection refused"));

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(processes, never()).requeueBusy(any(), any(), any());
                assertThat(process.getStatus()).isEqualTo("FAILED");
                assertThat(process.getErrorMessage()).contains("ai_service submit failed");
        }

        @Test
        void aRedispatchReplacesOldRowsAndKeepsATeachersEdit() {
                claimHolds();
                when(tracking.resetForRedispatch("process-1")).thenReturn(Set.of("essay"));
                when(client.submitGrade(any())).thenReturn("job-2");

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(tracking).resetForRedispatch("process-1");
                // The edited question keeps its row: no second row is inserted for it ...
                verify(tracking, never()).createQuestionEvaluation(any(), any(), anyInt());
                // ... it counts as settled (its callback is skipped) ...
                assertThat(process.getQuestionsTotal()).isEqualTo(1);
                assertThat(process.getQuestionsCompleted()).isEqualTo(1);
                // ... and the copy is still sent whole.
                verify(client).submitGrade(any());
        }

        @Test
        void aFirstDispatchCreatesOneTrackingRowPerQuestion() {
                claimHolds();
                when(tracking.resetForRedispatch("process-1")).thenReturn(Set.of());
                when(client.submitGrade(any())).thenReturn("job-1");

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(tracking).createQuestionEvaluation(eq(process), any(), eq(1));
                assertThat(process.getQuestionsCompleted()).isZero();
        }
}
