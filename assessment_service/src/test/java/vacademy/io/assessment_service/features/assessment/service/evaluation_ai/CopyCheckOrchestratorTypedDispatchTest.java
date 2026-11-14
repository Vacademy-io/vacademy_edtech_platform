package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * An online attempt (an essay or email typed in the player, no uploaded sheet)
 * goes to the AI as text: only its written questions, each with what the
 * learner typed, and no PDF.
 */
class CopyCheckOrchestratorTypedDispatchTest {

        private AiEvaluationProcessRepository processes;
        private QuestionWiseMarksRepository marks;
        private AiServiceCopyCheckClient client;
        private CopyCheckOrchestratorService service;
        private AiEvaluationProcess process;

        @BeforeEach
        void setUp() {
                processes = mock(AiEvaluationProcessRepository.class);
                marks = mock(QuestionWiseMarksRepository.class);
                client = mock(AiServiceCopyCheckClient.class);
                QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                ObjectMapper json = new ObjectMapper();
                EvaluationUtilityService utility = new EvaluationUtilityService(json, mappings);
                TypedAnswerEvaluation typed = new TypedAnswerEvaluation(utility, mappings, marks, json);
                AiQuestionEvaluationService tracking = mock(AiQuestionEvaluationService.class);
                service = new CopyCheckOrchestratorService(processes, marks, tracking,
                                mock(EvaluationUtilityService.class), client, json,
                                mock(OptionRepository.class), mappings, typed, new NoopTransactionManager(),
                                mock(vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.class), null);

                Assessment assessment = new Assessment();
                assessment.setId("assessment-1");
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("attempt-1");
                attempt.setAttemptData("{\"sections\":[]}");
                attempt.setSubmitTime(new Date());
                process = new AiEvaluationProcess();
                process.setId("process-1");
                process.setStudentAttempt(attempt);
                process.setAssessment(assessment);
                process.setClaimedBy("pod-a");
                process.setStatus("DISPATCHED");
                when(processes.findById("process-1")).thenReturn(Optional.of(process));
                // The guarded start: DISPATCHED -> PROCESSING for the claim holder.
                when(processes.beginDispatch(eq("process-1"), eq("pod-a"), any())).thenAnswer(i -> {
                        process.setStatus("PROCESSING");
                        return 1;
                });
                when(processes.handBackClaim(eq("process-1"), eq("pod-a"), any())).thenAnswer(i -> {
                        process.setStatus("PENDING");
                        process.setClaimedBy(null);
                        process.setClaimedAt(null);
                        return 1;
                });
                when(processes.save(any(AiEvaluationProcess.class))).thenAnswer(i -> i.getArgument(0));
                when(tracking.createQuestionEvaluation(any(), any(), anyInt())).thenReturn(null);
        }

        private static QuestionWiseMarks row(String qid, String type, String responseJson) {
                Question q = new Question();
                q.setId(qid);
                q.setQuestionType(type);
                q.setAutoEvaluationJson("{\"type\":\"LONG_ANSWER\",\"data\":{\"answer\":{\"id\":null,\"type\":\"HTML\","
                                + "\"content\":\"<p>Subject: Leave application</p><p>Respected Sir,</p>\"}}}");
                return QuestionWiseMarks.builder().id("qwm-" + qid).question(q).responseJson(responseJson).build();
        }

        @Test
        void sendsOnlyTheWrittenQuestionsWithTheTypedTextAndNoPdf() throws Exception {
                List<QuestionWiseMarks> rows = List.of(
                                row("mcq", "MCQS", "{\"responseData\":{\"type\":\"MCQS\",\"optionIds\":[\"o1\"]}}"),
                                row("essay", "LONG_ANSWER",
                                                "{\"responseData\":{\"type\":\"LONG_ANSWER\",\"answer\":\"<p>Dear Principal,</p>\"}}"));
                when(marks.findByStudentAttemptId("attempt-1")).thenReturn(rows);
                when(marks.findByStudentAttemptIdWithQuestionDetails("attempt-1")).thenReturn(rows);
                when(client.submitGrade(any())).thenReturn("job-1");

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                ArgumentCaptor<CopyCheckGradeRequestDto> sent = ArgumentCaptor.forClass(CopyCheckGradeRequestDto.class);
                verify(client).submitGrade(sent.capture());
                CopyCheckGradeRequestDto request = sent.getValue();
                assertThat(request.getAnswerMode()).isEqualTo("TYPED");
                assertThat(request.getPdfUrl()).isNull();
                assertThat(request.getQuestions()).hasSize(1);
                assertThat(request.getQuestions().get(0).getQuestionId()).isEqualTo("essay");
                assertThat(request.getQuestions().get(0).getStudentAnswer()).isEqualTo("<p>Dear Principal,</p>");
                assertThat(request.getQuestions().get(0).getModelAnswer())
                                .isEqualTo("Subject: Leave application Respected Sir,");
                assertThat(process.getQuestionsTotal()).isEqualTo(1);
        }

        @Test
        void aPaperWithNoWrittenQuestionFailsInsteadOfGradingTheMcqsAgain() {
                List<QuestionWiseMarks> rows = List.of(row("mcq", "MCQS", "{}"));
                when(marks.findByStudentAttemptId("attempt-1")).thenReturn(rows);
                when(marks.findByStudentAttemptIdWithQuestionDetails("attempt-1")).thenReturn(rows);

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(client, never()).submitGrade(any());
                assertThat(process.getStatus()).isEqualTo("FAILED");
        }

        @Test
        void aJustSubmittedAttemptWhoseMarksAreNotWrittenYetIsHandedBack() {
                when(marks.findByStudentAttemptId("attempt-1")).thenReturn(List.of());

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(client, never()).submitGrade(any());
                verify(processes).handBackClaim(eq("process-1"), eq("pod-a"), any());
                verify(processes, never()).beginDispatch(any(), any(), any());
                assertThat(process.getClaimedBy()).isNull();
                // Back to PENDING (11.2): a DISPATCHED row nobody owns would wait
                // for the sweeper's stale timeout.
                assertThat(process.getStatus()).isEqualTo("PENDING");
        }

        @Test
        void aManualUploadAssessmentWithoutAFileStillFailsAsBefore() {
                process.getAssessment().setEvaluationType("MANUAL");

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(client, never()).submitGrade(any());
                assertThat(process.getStatus()).isEqualTo("FAILED");
                assertThat(process.getErrorMessage()).contains("no file_id");
        }
}
