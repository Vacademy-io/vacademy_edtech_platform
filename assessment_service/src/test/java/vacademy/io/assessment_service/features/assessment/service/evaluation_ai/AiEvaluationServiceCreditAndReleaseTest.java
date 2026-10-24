package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AiEvaluationTriggerRequest;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCharge;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.Mode;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.Reservation;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.InsufficientCreditsException;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Enqueue-side billing and the release lock (T0.30, T0.33): every copy is priced and
 * checked before it is queued, a refusal fails the request with the reason (it is not
 * swallowed per attempt), and a released result is never queued on any channel.
 */
class AiEvaluationServiceCreditAndReleaseTest {

        private AiEvaluationProcessRepository processes;
        private EvaluationAccessValidator access;
        private AiEvaluationCreditGate credits;
        private QuestionAssessmentSectionMappingRepository mappings;
        private AiEvaluationService service;
        private final List<AiEvaluationProcess> saved = new ArrayList<>();

        @BeforeEach
        void setUp() {
                processes = mock(AiEvaluationProcessRepository.class);
                access = mock(EvaluationAccessValidator.class);
                credits = mock(AiEvaluationCreditGate.class);
                mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
                when(marks.findByStudentAttemptId(anyString())).thenReturn(List.of(new QuestionWiseMarks()));
                service = new AiEvaluationService(processes, mock(AiEvaluationAsyncService.class),
                                mock(AiEvaluationCancellationService.class), access, mappings, marks,
                                mock(TypedAnswerEvaluation.class), credits);
                when(processes.findActiveByAttemptId(anyString(), anyList())).thenReturn(List.of());
                when(processes.save(any(AiEvaluationProcess.class))).thenAnswer(i -> {
                        AiEvaluationProcess p = i.getArgument(0);
                        p.setId("proc-" + p.getStudentAttempt().getId());
                        saved.add(p);
                        return p;
                });
                when(access.requireAttemptAccess(any(), eq("inst-1"), anyString()))
                                .thenAnswer(i -> attempt(i.getArgument(2), null));
                // A paper with three live questions (and one deleted).
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1"))
                                .thenReturn(List.of(mapping("q1", "ACTIVE"), mapping("q2", "ACTIVE"),
                                                mapping("q3", null), mapping("q4", "DELETED")));
        }

        private static QuestionAssessmentSectionMapping mapping(String questionId, String status) {
                Question q = new Question();
                q.setId(questionId);
                q.setQuestionType("LONG_ANSWER");
                Section section = new Section();
                section.setStatus("ACTIVE");
                QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
                m.setQuestion(q);
                m.setSection(section);
                m.setStatus(status);
                return m;
        }

        private static StudentAttempt attempt(String id, String releaseStatus) {
                Assessment assessment = new Assessment();
                assessment.setId("a1");
                AssessmentUserRegistration reg = new AssessmentUserRegistration();
                reg.setAssessment(assessment);
                reg.setInstituteId("inst-1");
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId(id);
                attempt.setRegistration(reg);
                attempt.setReportReleaseStatus(releaseStatus);
                return attempt;
        }

        private static AiEvaluationTriggerRequest request(String... ids) {
                AiEvaluationTriggerRequest r = new AiEvaluationTriggerRequest();
                r.setAttemptIds(List.of(ids));
                r.setPreferredModel("m");
                return r;
        }

        private static Reservation reserved(String credits) {
                return new Reservation(new BigDecimal(credits), "{\"tool_key\":\"copy_check_evaluation\"}");
        }

        // ------------------------------------------------------------------ credits

        @Test
        @SuppressWarnings("unchecked")
        void oneCreditCheckCoversEveryCopyOfAMultiSelectAndEachRowKeepsItsQuote() {
                when(credits.reserve(eq("inst-1"), anyList(), any(), eq(Mode.DASHBOARD)))
                                .thenReturn(List.of(reserved("2"), reserved("2")));

                service.triggerEvaluation(request("att-1", "att-2"), null, "inst-1");

                ArgumentCaptor<List<AiEvaluationCharge>> charges = ArgumentCaptor.forClass(List.class);
                verify(credits, times(1)).reserve(eq("inst-1"), charges.capture(), eq(BigDecimal.ZERO), eq(Mode.DASHBOARD));
                // Priced per question on the paper: 3 live questions, the deleted one is not graded.
                assertThat(charges.getValue()).hasSize(2).allSatisfy(c -> {
                        assertThat(c.toolKey()).isEqualTo("copy_check_evaluation");
                        assertThat(c.params()).containsEntry("num_questions", 3);
                });
                assertThat(saved).hasSize(2).allSatisfy(row -> {
                        assertThat(row.getQuotedCredits()).isEqualByComparingTo("2");
                        assertThat(row.getRateSnapshot()).contains("copy_check_evaluation");
                        assertThat(row.getApiKeyId()).isNull();
                        assertThat(row.getPageCount()).isNull();
                });
        }

        @Test
        void aShortfallFailsTheWholeRequestBeforeAnyCopyIsQueued() {
                when(credits.reserve(eq("inst-1"), anyList(), any(), eq(Mode.DASHBOARD))).thenThrow(
                                new InsufficientCreditsException(BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE,
                                                BigDecimal.ZERO, BigDecimal.ZERO));

                assertThatThrownBy(() -> service.triggerEvaluation(request("att-1", "att-2"), null, "inst-1"))
                                .isInstanceOf(InsufficientCreditsException.class);
                assertThat(saved).isEmpty();
        }

        @Test
        void anAttemptAlreadyBeingCheckedIsNotChargedAgain() {
                AiEvaluationProcess running = new AiEvaluationProcess();
                running.setId("running-1");
                when(processes.findActiveByAttemptId(eq("att-1"), anyList())).thenReturn(List.of(running));

                List<String> ids = service.triggerEvaluation(request("att-1"), null, "inst-1");

                assertThat(ids).containsExactly("running-1");
                verify(credits, never()).reserve(any(), anyList(), any(), any());
                assertThat(saved).isEmpty();
        }

        @Test
        void aQueueChannelWithoutAReservationChecksItsOwnCopy() {
                when(credits.reserve(eq("inst-1"), anyList(), any(), eq(Mode.DASHBOARD)))
                                .thenReturn(List.of(reserved("2")));

                service.initiateEvaluationForAttempt(attempt("att-9", null), null, true);

                verify(credits).reserve("inst-1", List.of(AiEvaluationCharge.dashboard(3)), BigDecimal.ZERO,
                                Mode.DASHBOARD);
                assertThat(saved.get(0).getQuotedCredits()).isEqualByComparingTo("2");
        }

        @Test
        void aPartnerCopyIsPricedPerPageFailsClosedAndCarriesItsKeyAndPages() {
                AiEvaluationCharge perPage = AiEvaluationCharge.apiHandwritten(12);
                when(credits.reserve(eq("inst-1"), eq(List.of(perPage)), eq(new BigDecimal("500")), eq(Mode.API)))
                                .thenReturn(List.of(reserved("12")));

                service.initiateEvaluationForAttempt(attempt("att-7", null), null, true, null,
                                AiEvaluationEnqueueContext.api("key-1", new BigDecimal("500"), 12, perPage));

                AiEvaluationProcess row = saved.get(0);
                assertThat(row.getApiKeyId()).isEqualTo("key-1");
                assertThat(row.getPageCount()).isEqualTo(12);
                assertThat(row.getQuotedCredits()).isEqualByComparingTo("12");
                assertThat(row.getTriggeredBy()).isNull();
        }

        @Test
        void requireCreditsForCopiesChecksTheWholeUploadAtTheDashboardRate() {
                Assessment assessment = new Assessment();
                assessment.setId("a1");

                service.requireCreditsForCopies(assessment, "inst-1", 4);

                verify(credits).reserve("inst-1", java.util.Collections.nCopies(4, AiEvaluationCharge.dashboard(3)),
                                BigDecimal.ZERO, Mode.DASHBOARD);
        }

        // ------------------------------------------------------------- release lock

        @Test
        void aReleasedResultFailsTheTriggerWithTheReasonAndQueuesNothing() {
                when(access.requireAttemptAccess(any(), eq("inst-1"), eq("att-2")))
                                .thenReturn(attempt("att-2", "RELEASED"));

                assertThatThrownBy(() -> service.triggerEvaluation(request("att-1", "att-2"), null, "inst-1"))
                                .isInstanceOfSatisfying(ResultReleasedException.class, e -> {
                                        assertThat(e.getStatus().value()).isEqualTo(409);
                                        assertThat(e.getCode()).isEqualTo("submission_finalized");
                                        assertThat(e.getMessage()).contains("already been released");
                                });
                assertThat(saved).isEmpty();
                verify(credits, never()).reserve(any(), anyList(), any(), any());
        }

        @Test
        void aReleasedResultIsRefusedOnTheQueueChannelsToo() {
                assertThatThrownBy(() -> service.initiateEvaluationForAttempt(attempt("att-3", "RELEASED"), null, true))
                                .isInstanceOf(ResultReleasedException.class);
                assertThat(saved).isEmpty();
        }

        @Test
        void aPendingReleaseIsNotALock() {
                when(credits.reserve(any(), anyList(), any(), any())).thenReturn(List.of(reserved("1")));

                service.initiateEvaluationForAttempt(attempt("att-4", "PENDING"), null, true);

                assertThat(saved).hasSize(1);
        }
}
