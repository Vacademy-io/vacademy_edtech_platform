package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.task.TaskRejectedException;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AiEvaluationTriggerRequest;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The dashboard's triggers (11.2): one row clicked = dispatched at once, but as a
 * claimed DISPATCHED row under its own token so the poller can never send it a
 * second time; a multi-select goes through the fair queue. Every row carries its
 * institute and lane.
 */
class AiEvaluationServiceDispatchModeTest {

        private AiEvaluationProcessRepository processes;
        private AiEvaluationAsyncService worker;
        private EvaluationAccessValidator access;
        private TypedAnswerEvaluation typed;
        private AiEvaluationService service;
        private vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate credits;
        private final List<AiEvaluationProcess> saved = new ArrayList<>();

        @BeforeEach
        void setUp() {
                processes = mock(AiEvaluationProcessRepository.class);
                worker = mock(AiEvaluationAsyncService.class);
                access = mock(EvaluationAccessValidator.class);
                typed = mock(TypedAnswerEvaluation.class);
                credits = mock(vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.class);
                QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
                when(marks.findByStudentAttemptId(anyString())).thenReturn(List.of(new QuestionWiseMarks()));
                service = new AiEvaluationService(processes, worker, mock(AiEvaluationCancellationService.class),
                                access, mock(QuestionAssessmentSectionMappingRepository.class), marks, typed, credits);
                when(processes.findActiveByAttemptId(anyString(), anyList())).thenReturn(List.of());
                when(processes.save(any(AiEvaluationProcess.class))).thenAnswer(i -> {
                        AiEvaluationProcess p = i.getArgument(0);
                        p.setId("proc-" + p.getStudentAttempt().getId());
                        saved.add(p);
                        return p;
                });
                when(access.requireAttemptAccess(any(), eq("inst-1"), anyString()))
                                .thenAnswer(i -> attempt(i.getArgument(2)));
        }

        private static StudentAttempt attempt(String id) {
                Assessment assessment = new Assessment();
                assessment.setId("a1");
                AssessmentUserRegistration reg = new AssessmentUserRegistration();
                reg.setAssessment(assessment);
                reg.setInstituteId("inst-1");
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId(id);
                attempt.setRegistration(reg);
                return attempt;
        }

        private static AiEvaluationTriggerRequest request(String... ids) {
                AiEvaluationTriggerRequest r = new AiEvaluationTriggerRequest();
                r.setAttemptIds(List.of(ids));
                r.setPreferredModel("m");
                return r;
        }

        @Test
        void aSingleClickIsClaimedAndDispatchedUnderItsOwnToken() {
                service.triggerEvaluation(request("att-1"), null, "inst-1");

                assertThat(saved).hasSize(1);
                AiEvaluationProcess row = saved.get(0);
                assertThat(row.getStatus()).isEqualTo("DISPATCHED");
                assertThat(row.getClaimedBy()).startsWith("direct-");
                assertThat(row.getInstituteId()).isEqualTo("inst-1");
                assertThat(row.getLane()).isEqualTo("COPY");
                verify(worker).evaluateAttemptAsync("proc-att-1", "att-1", "m", row.getClaimedBy());
        }

        @Test
        void aMultiSelectGoesThroughTheQueue() {
                service.triggerEvaluation(request("att-1", "att-2"), null, "inst-1");

                assertThat(saved).hasSize(2).allSatisfy(row -> {
                        assertThat(row.getStatus()).isEqualTo("PENDING");
                        assertThat(row.getClaimedBy()).isNull();
                });
                verify(worker, never()).evaluateAttemptAsync(any(), any(), any(), any());
        }

        @Test
        void anOnlineAttemptGoesToTheTypedLane() {
                when(typed.isTypedAttempt(any(), any())).thenReturn(true);

                service.initiateEvaluationForAttempt(attempt("att-9"), null, true);

                assertThat(saved.get(0).getLane()).isEqualTo("TYPED");
        }

        @Test
        void aDirectRunTheExecutorRefusesFallsBackToTheQueue() {
                doThrow(new TaskRejectedException("full")).when(worker).evaluateAttemptAsync(any(), any(), any(), any());

                service.triggerEvaluation(request("att-1"), null, "inst-1");

                ArgumentCaptor<String> token = ArgumentCaptor.forClass(String.class);
                verify(processes).handBackClaim(eq("proc-att-1"), token.capture(), any());
                assertThat(token.getValue()).isEqualTo(saved.get(0).getClaimedBy());
        }
}
