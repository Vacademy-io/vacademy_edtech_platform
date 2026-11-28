package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckCallbackDto;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.CopyCheckLayoutRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;

import java.math.BigDecimal;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The same question in two sections of one paper (the create-test wizard saved every
 * section twice, Prepper "FR Mock 1", 2026-11-18). Dispatch used to insert a second
 * ai_question_evaluation row for it, hit uq_ai_question_eval_process_question and fail
 * the whole run as rollback-only. Now: graded once, the verdict on every marks row of
 * the question, counted once per row - as the submit-time total counts it.
 */
class AiEvaluationDuplicateQuestionTest {

        private static Question essay(String id) {
                Question q = new Question();
                q.setId(id);
                q.setQuestionType("LONG_ANSWER");
                return q;
        }

        private static QuestionWiseMarks row(String id, Question q, String sectionId, double value) {
                Section section = new Section();
                section.setId(sectionId);
                return QuestionWiseMarks.builder().id(id).question(q).section(section).marks(value)
                                .responseJson("{\"responseData\":{\"answer\":\"Dear Sir\"}}").build();
        }

        @Test
        void aQuestionInTwoSectionsIsDispatchedOnceWithOneTrackingRow() {
                AiEvaluationProcessRepository processes = mock(AiEvaluationProcessRepository.class);
                QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
                AiServiceCopyCheckClient client = mock(AiServiceCopyCheckClient.class);
                QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                AiQuestionEvaluationService tracking = mock(AiQuestionEvaluationService.class);
                when(tracking.resetForRedispatch(any())).thenReturn(Set.of());
                ObjectMapper json = new ObjectMapper();
                TypedAnswerEvaluation typed = new TypedAnswerEvaluation(new EvaluationUtilityService(json, mappings),
                                mappings, marks, json);
                CopyCheckOrchestratorService service = new CopyCheckOrchestratorService(processes, marks, tracking,
                                mock(EvaluationUtilityService.class), client, json, mock(OptionRepository.class), mappings,
                                typed, new NoopTransactionManager(), mock(AiEvaluationCreditGate.class), null);

                Assessment assessment = new Assessment();
                assessment.setId("assessment-1");
                assessment.setAiEvaluationEnabled(true);
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("attempt-1");
                attempt.setAttemptData("{\"sections\":[]}");
                attempt.setSubmitTime(new Date(System.currentTimeMillis() - 3_600_000L));
                AiEvaluationProcess process = new AiEvaluationProcess();
                process.setId("process-1");
                process.setStudentAttempt(attempt);
                process.setAssessment(assessment);
                process.setClaimedBy("pod-a");
                process.setStatus("DISPATCHED");
                when(processes.findById("process-1")).thenReturn(Optional.of(process));
                when(processes.save(any(AiEvaluationProcess.class))).thenAnswer(i -> i.getArgument(0));
                when(processes.beginDispatch(eq("process-1"), eq("pod-a"), any())).thenAnswer(i -> {
                        process.setStatus("PROCESSING");
                        return 1;
                });
                Question q1 = essay("q1");
                Question q2 = essay("q2");
                List<QuestionWiseMarks> rows = List.of(row("a-q1", q1, "sec-a", 0), row("a-q2", q2, "sec-a", 0),
                                row("b-q1", q1, "sec-b", 0), row("b-q2", q2, "sec-b", 0));
                when(marks.findByStudentAttemptId("attempt-1")).thenReturn(rows);
                when(marks.findByStudentAttemptIdWithQuestionDetails("attempt-1")).thenReturn(rows);
                when(client.submitGrade(any())).thenReturn("job-1");

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                verify(tracking, times(1)).createQuestionEvaluation(eq(process), eq(q1), anyInt());
                verify(tracking, times(1)).createQuestionEvaluation(eq(process), eq(q2), anyInt());
                ArgumentCaptor<CopyCheckGradeRequestDto> sent = ArgumentCaptor.forClass(CopyCheckGradeRequestDto.class);
                verify(client).submitGrade(sent.capture());
                assertThat(sent.getValue().getQuestions()).extracting(CopyCheckGradeRequestDto.QuestionInput::getQuestionId)
                                .containsExactly("q1", "q2");
                assertThat(process.getQuestionsTotal()).isEqualTo(2);
                assertThat(process.getStatus()).isEqualTo("PROCESSING");
        }

        @Test
        void oncePerQuestionKeepsTheFirstRowAndRowsWithoutAQuestion() {
                Question q1 = essay("q1");
                QuestionWiseMarks first = row("a", q1, "sec-a", 0);
                QuestionWiseMarks second = row("b", q1, "sec-b", 0);
                QuestionWiseMarks orphan = QuestionWiseMarks.builder().id("orphan").build();
                assertThat(TypedAnswerEvaluation.oncePerQuestion(List.of(first, orphan, second)))
                                .containsExactly(first, orphan);
                List<QuestionWiseMarks> normal = List.of(first, row("c", essay("q2"), "sec-a", 0));
                assertThat(TypedAnswerEvaluation.oncePerQuestion(normal)).isSameAs(normal);
        }

        @Test
        void theVerdictIsTheMarkOfEveryRowOfTheQuestion() {
                AiEvaluationProcessRepository processes = mock(AiEvaluationProcessRepository.class);
                AiQuestionEvaluationRepository tracking = mock(AiQuestionEvaluationRepository.class);
                QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
                CopyCheckCallbackService service = new CopyCheckCallbackService(processes, mock(CopyIntakeService.class),
                                tracking, mock(CopyCheckLayoutRepository.class), marks,
                                mock(StudentAttemptRepository.class), mock(AiEvaluationCancellationService.class),
                                mock(TypedAnswerEvaluation.class), new ObjectMapper());
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("attempt-1");
                AiEvaluationProcess process = new AiEvaluationProcess();
                process.setId("process-1");
                process.setStatus("EVALUATING");
                process.setStudentAttempt(attempt);
                when(processes.findById("process-1")).thenReturn(Optional.of(process));
                AiQuestionEvaluation tracked = new AiQuestionEvaluation();
                tracked.setStatus("PENDING");
                when(tracking.findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc("process-1", "q1"))
                                .thenReturn(List.of(tracked));
                Question q1 = essay("q1");
                QuestionWiseMarks inA = row("a-q1", q1, "sec-a", 0);
                QuestionWiseMarks inB = row("b-q1", q1, "sec-b", 0);
                when(marks.findAllByAttemptIdAndQuestionId("attempt-1", "q1")).thenReturn(List.of(inA, inB));

                service.onQuestionDone(CopyCheckCallbackDto.QuestionDone.builder().processId("process-1")
                                .questionId("q1").status("COMPLETED").marksAwarded(7.5).maxMarks(10.0).build());

                assertThat(inA.getMarks()).isEqualTo(7.5);
                assertThat(inB.getMarks()).isEqualTo(7.5);
                assertThat(inA.getMarksSource()).isEqualTo("AI");
                assertThat(inB.getMarksSource()).isEqualTo("AI");
                verify(marks).save(inA);
                verify(marks).save(inB);
                verify(processes, times(1)).incrementQuestionsCompleted(eq("process-1"), any());
        }

        @Test
        void aTeachersOverrideIsTheMarkOfEveryRowOfTheQuestion() {
                AiEvaluationProcessRepository processes = mock(AiEvaluationProcessRepository.class);
                AiQuestionEvaluationRepository tracking = mock(AiQuestionEvaluationRepository.class);
                QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
                AiEvaluationReviewService service = new AiEvaluationReviewService(processes, tracking, marks,
                                mock(StudentAttemptRepository.class), mock(TypedAnswerEvaluation.class), new ResultLockGuard());
                Assessment exam = new Assessment();
                exam.setId("a1");
                AssessmentUserRegistration registration = new AssessmentUserRegistration();
                registration.setAssessment(exam);
                registration.setStudentAttempts(new HashSet<>());
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("attempt-1");
                attempt.setRegistration(registration);
                AiEvaluationProcess process = new AiEvaluationProcess();
                process.setId("process-1");
                process.setStudentAttempt(attempt);
                when(processes.findByIdWithStudentAttempt("process-1")).thenReturn(Optional.of(process));
                AiQuestionEvaluation tracked = new AiQuestionEvaluation();
                tracked.setMaxMarks(BigDecimal.TEN);
                when(tracking.findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc("process-1", "q1"))
                                .thenReturn(List.of(tracked));
                Question q1 = essay("q1");
                QuestionWiseMarks inA = row("a-q1", q1, "sec-a", 7.5);
                QuestionWiseMarks inB = row("b-q1", q1, "sec-b", 7.5);
                when(marks.findAllByAttemptIdAndQuestionId("attempt-1", "q1")).thenReturn(List.of(inA, inB));

                service.overrideQuestion("process-1", "q1", 6.0, "Good", "teacher-1");

                assertThat(inA.getMarks()).isEqualTo(6.0);
                assertThat(inB.getMarks()).isEqualTo(6.0);
                assertThat(inA.getMarksSource()).isEqualTo("AI_REVIEWED");
                assertThat(inB.getEvaluatorFeedback()).isEqualTo("Good");
        }

        @Test
        void anOnlineTotalCountsTheVerdictOncePerRowLikeTheSubmitTimeTotal() {
                QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
                ObjectMapper json = new ObjectMapper();
                TypedAnswerEvaluation typed = new TypedAnswerEvaluation(new EvaluationUtilityService(json, mappings),
                                mappings, marks, json);
                Assessment assessment = new Assessment();
                assessment.setId("a1");
                assessment.setEvaluationType("AUTO");
                AssessmentUserRegistration registration = new AssessmentUserRegistration();
                registration.setAssessment(assessment);
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("attempt-1");
                attempt.setRegistration(registration);
                attempt.setAttemptData("{\"sections\":[]}");
                Question mcq = new Question();
                mcq.setId("mcq");
                mcq.setQuestionType("MCQS");
                Question q1 = essay("q1");
                // Section A and its accidental copy B: the MCQ scored 1 in each, the essay twice.
                when(marks.findByStudentAttemptId("attempt-1")).thenReturn(List.of(
                                row("a-mcq", mcq, "sec-a", 1), row("a-q1", q1, "sec-a", 0),
                                row("b-mcq", mcq, "sec-b", 1), row("b-q1", q1, "sec-b", 0)));
                AiQuestionEvaluation verdict = AiQuestionEvaluation.builder().question(q1).status("COMPLETED")
                                .marksAwarded(BigDecimal.valueOf(7.5)).build();

                // 1 + 1 for the MCQ rows, 7.5 for each of the essay's two rows.
                assertThat(typed.attemptTotal(attempt, List.of(verdict))).isEqualTo(17.0);
        }

        @Test
        void twoRowsOfTheSameSectionCountTheVerdictOnceLikeTheSubmitTimeTotal() {
                // question_wise_marks has no unique (attempt, question, section) key and old
                // duplicate rows exist (V34); the submit-time total counts a section once.
                QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
                ObjectMapper json = new ObjectMapper();
                TypedAnswerEvaluation typed = new TypedAnswerEvaluation(new EvaluationUtilityService(json, mappings),
                                mappings, marks, json);
                Assessment assessment = new Assessment();
                assessment.setId("a1");
                assessment.setEvaluationType("AUTO");
                AssessmentUserRegistration registration = new AssessmentUserRegistration();
                registration.setAssessment(assessment);
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("attempt-1");
                attempt.setRegistration(registration);
                attempt.setAttemptData("{\"sections\":[]}");
                Question q1 = essay("q1");
                when(marks.findByStudentAttemptId("attempt-1")).thenReturn(List.of(
                                row("a-q1", q1, "sec-a", 0), row("a-q1-dup", q1, "sec-a", 0)));
                AiQuestionEvaluation verdict = AiQuestionEvaluation.builder().question(q1).status("COMPLETED")
                                .marksAwarded(BigDecimal.valueOf(7)).build();

                assertThat(typed.attemptTotal(attempt, List.of(verdict))).isEqualTo(7.0);
        }
}
