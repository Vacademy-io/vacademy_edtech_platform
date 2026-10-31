package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCharge;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.DispatchCheck;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.DispatchVerdict;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.Reservation;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;

import java.math.BigDecimal;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Dispatch-time billing (T0.30, T0.31, T0.33): a claimed copy whose result was released
 * meanwhile, or whose quote the balance no longer covers, fails before anything is sent
 * (so it is never billed); a partner copy carries its billing actor, rate and pages;
 * a dashboard request carries none of them; every question carries the subject.
 */
class CopyCheckOrchestratorBillingTest {

        private AiEvaluationProcessRepository processes;
        private AiServiceCopyCheckClient client;
        private AiEvaluationCreditGate credits;
        private AssessmentInstituteMappingRepository instituteMappings;
        private CopyCheckOrchestratorService service;
        private AiEvaluationProcess process;
        private StudentAttempt attempt;

        @BeforeEach
        @SuppressWarnings("unchecked")
        void setUp() {
                processes = mock(AiEvaluationProcessRepository.class);
                QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
                client = mock(AiServiceCopyCheckClient.class);
                AiQuestionEvaluationService tracking = mock(AiQuestionEvaluationService.class);
                when(tracking.resetForRedispatch(any())).thenReturn(Set.of());
                credits = mock(AiEvaluationCreditGate.class);
                instituteMappings = mock(AssessmentInstituteMappingRepository.class);
                QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                ObjectMapper json = new ObjectMapper();
                EvaluationUtilityService utility = new EvaluationUtilityService(json, mappings);
                TypedAnswerEvaluation typed = new TypedAnswerEvaluation(utility, mappings, marks, json);
                ObjectProvider<CopyCheckGradeContextProvider> noProvider = mock(ObjectProvider.class);
                CopyCheckGradeRequestEnricher enricher = new CopyCheckGradeRequestEnricher(instituteMappings, noProvider,
                                credits);
                service = new CopyCheckOrchestratorService(processes, marks, tracking,
                                mock(EvaluationUtilityService.class), client, json,
                                mock(OptionRepository.class), mappings, typed, new NoopTransactionManager(), credits,
                                enricher);

                Assessment assessment = new Assessment();
                assessment.setId("assessment-1");
                attempt = new StudentAttempt();
                attempt.setId("attempt-1");
                attempt.setAttemptData("{\"sections\":[]}");
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
                when(processes.beginDispatch(eq("process-1"), eq("pod-a"), any())).thenAnswer(i -> {
                        process.setStatus("PROCESSING");
                        return 1;
                });

                Question essay = new Question();
                essay.setId("essay");
                essay.setQuestionType("LONG_ANSWER");
                Question mcq = new Question();
                mcq.setId("mcq");
                mcq.setQuestionType("MCQS");
                List<QuestionWiseMarks> rows = List.of(
                                QuestionWiseMarks.builder().id("qwm-essay").question(essay)
                                                .responseJson("{\"responseData\":{\"answer\":\"Dear Principal\"}}").build(),
                                QuestionWiseMarks.builder().id("qwm-mcq").question(mcq).build());
                when(marks.findByStudentAttemptId("attempt-1")).thenReturn(rows);
                when(marks.findByStudentAttemptIdWithQuestionDetails("attempt-1")).thenReturn(rows);
                when(client.submitGrade(any())).thenReturn("job-1");
        }

        private void verdict(DispatchVerdict verdict, Reservation newQuote) {
                when(credits.checkAtDispatch(any(), any(), any(), any(), anyBoolean()))
                                .thenReturn(new DispatchCheck(verdict, BigDecimal.valueOf(3), BigDecimal.ONE, BigDecimal.ZERO,
                                                newQuote));
        }

        private CopyCheckGradeRequestDto sent() {
                ArgumentCaptor<CopyCheckGradeRequestDto> request = ArgumentCaptor.forClass(CopyCheckGradeRequestDto.class);
                verify(client).submitGrade(request.capture());
                return request.getValue();
        }

        @Test
        void aResultReleasedWhileTheCopyWaitedFailsItUnsent() {
                attempt.setReportReleaseStatus("RELEASED");

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(processes).failClaimed(eq("process-1"), eq("pod-a"), eq("RESULT_RELEASED"),
                                contains("not billed"), any());
                verify(processes, never()).beginDispatch(any(), any(), any());
                verify(client, never()).submitGrade(any());
                verify(credits, never()).checkAtDispatch(any(), any(), any(), any(), anyBoolean());
        }

        @Test
        void aBalanceThatNoLongerCoversTheQuoteFailsItWithInsufficientCreditsUnsent() {
                verdict(DispatchVerdict.INSUFFICIENT, null);

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(processes).failClaimed(eq("process-1"), eq("pod-a"), eq("INSUFFICIENT_CREDITS"),
                                contains("insufficient_credits"), any());
                verify(processes, never()).beginDispatch(any(), any(), any());
                verify(client, never()).submitGrade(any());
        }

        @Test
        void anApiCopyWhoseCreditCheckCannotBeMadeGoesBackToTheQueue() {
                verdict(DispatchVerdict.UNAVAILABLE, null);

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(processes).handBackClaim(eq("process-1"), eq("pod-a"), any());
                verify(client, never()).submitGrade(any());
        }

        @Test
        void aRowQueuedWithoutAQuoteIsPricedPerQuestionAndTheQuoteStored() {
                Reservation quote = new Reservation(BigDecimal.valueOf(2), "{\"tool_key\":\"copy_check_evaluation\"}");
                verdict(DispatchVerdict.PROCEED, quote);

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                // Online attempt (no sheet): only the written question is graded, so priced as one.
                verify(credits).checkAtDispatch(eq("inst-1"), isNull(), isNull(), eq(AiEvaluationCharge.dashboard(1)),
                                eq(false));
                verify(processes).recordQuote(eq("process-1"), eq(BigDecimal.valueOf(2)), anyString(), any());
                verify(client).submitGrade(any());
        }

        @Test
        void aDashboardRequestCarriesNoBillingFieldsButEveryQuestionGetsTheSubject() {
                verdict(DispatchVerdict.PROCEED, null);
                AssessmentInstituteMapping mapping = new AssessmentInstituteMapping();
                mapping.setSubjectId("Physics");
                when(instituteMappings.findByAssessmentIdAndInstituteId("assessment-1", "inst-1"))
                                .thenReturn(Optional.of(mapping));

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                CopyCheckGradeRequestDto request = sent();
                assertThat(request.getBillingActor()).isNull();
                assertThat(request.getRateSnapshot()).isNull();
                assertThat(request.getPageCount()).isNull();
                assertThat(request.getInstituteId()).isEqualTo("inst-1");
                assertThat(request.getQuestions()).isNotEmpty()
                                .allSatisfy(q -> assertThat(q.getSubject()).isEqualTo("Physics"));
        }

        @Test
        void aPartnerRequestCarriesItsBillingActorRateAndPages() {
                verdict(DispatchVerdict.PROCEED, null);
                process.setApiKeyId("key-1");
                process.setPageCount(12);
                process.setQuotedCredits(BigDecimal.valueOf(12));
                process.setRateSnapshot("{\"tool_key\":\"copy_check_evaluation_api\"}");
                Map<String, Object> rate = Map.of("tool_key", "copy_check_evaluation_api", "flat_base_credits", 0,
                                "per_unit_credits", 1, "unit_field", "pages", "params", Map.of("fixed_price", true),
                                "rate_source", "global");
                when(credits.gradeRequestSnapshot("{\"tool_key\":\"copy_check_evaluation_api\"}")).thenReturn(rate);

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(credits).checkAtDispatch(eq("inst-1"), eq(BigDecimal.valueOf(12)),
                                eq("{\"tool_key\":\"copy_check_evaluation_api\"}"), isNull(), eq(true));
                CopyCheckGradeRequestDto request = sent();
                assertThat(request.getBillingActor()).isEqualTo("apikey:key-1");
                assertThat(request.getRateSnapshot()).isEqualTo(rate);
                assertThat(request.getPageCount()).isEqualTo(12);
        }

        @Test
        void aDashboardJsonPayloadIsUnchangedByTheNewFields() throws Exception {
                verdict(DispatchVerdict.PROCEED, null);

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                String payload = new ObjectMapper().writeValueAsString(sent());
                assertThat(payload).doesNotContain("billing_actor").doesNotContain("rate_snapshot")
                                .doesNotContain("page_count").doesNotContain("exam_context")
                                .doesNotContain("choice_groups").doesNotContain("paper_max");
        }
}
