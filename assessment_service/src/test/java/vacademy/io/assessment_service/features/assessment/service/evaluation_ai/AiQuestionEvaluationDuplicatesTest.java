package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckCallbackDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.CopyCheckLayoutRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * T0.29: a process dispatched twice before V53 has two tracking rows per question.
 * Reads take the newest row - in the callback, the totals and the review override -
 * so a duplicate can neither throw ("2 results were returned") nor count twice.
 * Progress callbacks write step/status only, never the whole row.
 */
class AiQuestionEvaluationDuplicatesTest {

        private AiEvaluationProcessRepository processes;
        private AiQuestionEvaluationRepository rows;
        private StudentAttemptRepository attempts;
        private AiEvaluationProcess process;
        private StudentAttempt attempt;

        @BeforeEach
        void setUp() {
                processes = mock(AiEvaluationProcessRepository.class);
                rows = mock(AiQuestionEvaluationRepository.class);
                attempts = mock(StudentAttemptRepository.class);
                Assessment assessment = new Assessment();
                assessment.setId("a1");
                assessment.setEvaluationType("MANUAL"); // an uploaded copy: no typed add-back
                AssessmentUserRegistration reg = new AssessmentUserRegistration();
                reg.setAssessment(assessment);
                attempt = new StudentAttempt();
                attempt.setId("att-1");
                attempt.setRegistration(reg);
                process = new AiEvaluationProcess();
                process.setId("p1");
                process.setStatus("COMPLETED");
                process.setStudentAttempt(attempt);
                process.setAssessment(assessment);
                when(processes.findById("p1")).thenReturn(Optional.of(process));
                when(processes.findByIdWithStudentAttempt("p1")).thenReturn(Optional.of(process));
                when(attempts.findById("att-1")).thenReturn(Optional.of(attempt));
        }

        private TypedAnswerEvaluation typed() {
                return mock(TypedAnswerEvaluation.class, inv -> {
                        if (inv.getMethod().getName().equals("attemptTotal")) {
                                List<AiQuestionEvaluation> list = inv.getArgument(1);
                                return list.stream().filter(r -> "COMPLETED".equals(r.getStatus()))
                                                .mapToDouble(r -> r.getMarksAwarded().doubleValue()).sum();
                        }
                        return org.mockito.Answers.RETURNS_DEFAULTS.answer(inv);
                });
        }

        // ------------------------------------------------------------- the helper

        @Test
        void newestPerQuestionKeepsOneRowPerQuestionInOrder() {
                AiQuestionEvaluation q1old = Rows.row("r1", "q1", "COMPLETED", 4, 1_000);
                AiQuestionEvaluation q1new = Rows.row("r2", "q1", "PENDING", null, 2_000);
                AiQuestionEvaluation q2 = Rows.row("r3", "q2", "COMPLETED", 3, 1_500);

                List<AiQuestionEvaluation> out = AiQuestionEvaluationService.newestPerQuestion(List.of(q1old, q2, q1new));

                assertThat(out).containsExactly(q1new, q2);
        }

        @Test
        void newestPerQuestionLeavesAListWithoutDuplicatesAlone() {
                List<AiQuestionEvaluation> clean = List.of(Rows.row("r1", "q1", "COMPLETED", 4, 1_000),
                                Rows.row("r2", "q2", "COMPLETED", 3, 1_000));
                assertThat(AiQuestionEvaluationService.newestPerQuestion(clean)).isSameAs(clean);
                assertThat(AiQuestionEvaluationService.newestPerQuestion(List.of())).isEmpty();
        }

        @Test
        void aMissingCreatedAtCountsAsOldestAndIdBreaksTies() {
                AiQuestionEvaluation noDate = Rows.row("r9", "q1", "COMPLETED", 1, null);
                AiQuestionEvaluation dated = Rows.row("r1", "q1", "COMPLETED", 2, 1_000);
                assertThat(AiQuestionEvaluationService.newest(List.of(dated, noDate))).contains(dated);
                AiQuestionEvaluation a = Rows.row("a", "q1", "COMPLETED", 1, 1_000);
                AiQuestionEvaluation b = Rows.row("b", "q1", "COMPLETED", 1, 1_000);
                assertThat(AiQuestionEvaluationService.newest(List.of(b, a))).contains(b);
        }

        @Test
        void resetForRedispatchDeletesNonEditedRowsAndReportsTheKeptOnes() {
                when(rows.findEditedQuestionIds("p1")).thenReturn(List.of("q2"));
                when(rows.deleteNonEditedForProcess("p1")).thenReturn(3);
                AiQuestionEvaluationService service = new AiQuestionEvaluationService(rows, new ObjectMapper());

                Set<String> kept = service.resetForRedispatch("p1");

                assertThat(kept).containsExactly("q2");
                verify(rows).deleteNonEditedForProcess("p1");
        }

        // ------------------------------------------------------------- review override

        @Test
        void aReviewerCanOverrideAQuestionThatHasTwoRows() {
                AiQuestionEvaluation older = Rows.row("r1", "q1", "PENDING", null, 1_000);
                AiQuestionEvaluation newer = Rows.row("r2", "q1", "COMPLETED", 3, 2_000);
                newer.setMaxMarks(java.math.BigDecimal.valueOf(5));
                when(rows.findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc("p1", "q1"))
                                .thenReturn(List.of(newer, older));
                when(rows.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of(older, newer));
                AiEvaluationReviewService review = new AiEvaluationReviewService(processes, rows,
                                mock(QuestionWiseMarksRepository.class), attempts, typed(),
                                new vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard());

                review.overrideQuestion("p1", "q1", 4.0, "good", "teacher-1");

                assertThat(newer.getIsEdited()).isTrue();
                assertThat(newer.getMarksAwarded().doubleValue()).isEqualTo(4.0);
                assertThat(older.getIsEdited()).isNotEqualTo(Boolean.TRUE);
                // The total reads one row per question: 4, not 4 + the stale row.
                assertThat(attempt.getTotalMarks()).isEqualTo(4.0);
        }

        // ------------------------------------------------------------- callbacks

        private CopyCheckCallbackService callbacks() {
                return new CopyCheckCallbackService(processes, mock(CopyIntakeService.class), rows,
                                mock(CopyCheckLayoutRepository.class), mock(QuestionWiseMarksRepository.class), attempts,
                                mock(AiEvaluationCancellationService.class), typed(), new ObjectMapper());
        }

        @Test
        void theCompleteCallbackCountsEachQuestionOnce() {
                process.setStatus("EVALUATING");
                AiQuestionEvaluation q1first = Rows.row("r1", "q1", "COMPLETED", 4, 1_000);
                AiQuestionEvaluation q1second = Rows.row("r2", "q1", "COMPLETED", 4, 2_000);
                AiQuestionEvaluation q2 = Rows.row("r3", "q2", "COMPLETED", 3, 1_000);
                when(rows.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1"))
                                .thenReturn(List.of(q1first, q1second, q2));

                callbacks().onComplete(CopyCheckCallbackDto.Complete.builder().processId("p1").build());

                assertThat(attempt.getTotalMarks()).isEqualTo(7.0);
                assertThat(attempt.getResultStatus()).isEqualTo("COMPLETED");
        }

        @Test
        void aProgressCallbackWritesOnlyStepAndStatus() {
                process.setStatus("PROCESSING");
                process.setCurrentStep("AI_SERVICE_SUBMITTED");
                process.setClaimedBy("pod-a");

                callbacks().onProgress(CopyCheckCallbackDto.Progress.builder().processId("p1").step("GRADING").build());

                verify(processes).applyProgressStepAndStatus(eq("p1"), eq("GRADING"), eq("EVALUATING"), any(),
                                anyList());
                verify(processes, never()).save(any());
                // The loaded entity is untouched, so nothing else can be flushed from it.
                assertThat(process.getStatus()).isEqualTo("PROCESSING");
                assertThat(process.getClaimedBy()).isEqualTo("pod-a");
        }

        @Test
        void aProgressStepWithoutAStatusChangeKeepsTheStatus() {
                process.setStatus("EXTRACTING");
                process.setCurrentStep("LAYOUT_OCR_DONE");

                callbacks().onProgress(CopyCheckCallbackDto.Progress.builder().processId("p1").step("OCR_PAGE_3").build());

                ArgumentCaptor<List<String>> terminal = ArgumentCaptor.forClass(List.class);
                verify(processes).applyProgressStep(eq("p1"), eq("OCR_PAGE_3"), any(), terminal.capture());
                assertThat(terminal.getValue()).contains("COMPLETED", "FAILED", "CANCELLED");
                verify(processes, never()).save(any());
        }

        @Test
        void aQuestionCallbackCountsInSqlNotByRewritingTheRow() {
                process.setStatus("EVALUATING");
                when(rows.findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc("p1", "q1"))
                                .thenReturn(List.of(Rows.row("r1", "q1", "PENDING", null, 1_000)));

                callbacks().onQuestionDone(CopyCheckCallbackDto.QuestionDone.builder()
                                .processId("p1").questionId("q1").marksAwarded(2.0).maxMarks(5.0).build());

                verify(processes).incrementQuestionsCompleted(eq("p1"), any());
                verify(processes, never()).save(any());
        }

        @Test
        void aRetriedQuestionCallbackIsNotCountedTwice() {
                process.setStatus("EVALUATING");
                when(rows.findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc("p1", "q1"))
                                .thenReturn(List.of(Rows.row("r1", "q1", "COMPLETED", 2, 1_000)));

                callbacks().onQuestionDone(CopyCheckCallbackDto.QuestionDone.builder()
                                .processId("p1").questionId("q1").marksAwarded(2.0).build());

                verify(processes, never()).incrementQuestionsCompleted(anyString(), any());
        }
}
