package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.submission_review.service.MarkWriter;

import java.math.BigDecimal;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Contract 7.2: the AI review PUT is a thin wrapper over MarkWriter (AI_REVIEWED, verdict kept in step). */
class ReviewPutWrapperTest {

    @Test
    @SuppressWarnings("unchecked")
    void review_put_writes_through_mark_writer_per_section_and_updates_the_verdict() {
        AiEvaluationProcessRepository processes = mock(AiEvaluationProcessRepository.class);
        AiQuestionEvaluationRepository tracking = mock(AiQuestionEvaluationRepository.class);
        QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
        StudentAttemptRepository attempts = mock(StudentAttemptRepository.class);
        TypedAnswerEvaluation typed = mock(TypedAnswerEvaluation.class);
        AiEvaluationReviewService service = new AiEvaluationReviewService(processes, tracking, marks, attempts, typed,
                new ResultLockGuard());
        MarkWriter writer = mock(MarkWriter.class);
        ReflectionTestUtils.setField(service, "markWriter", writer);

        Assessment exam = new Assessment();
        exam.setId("a1");
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(exam);
        r.setStudentAttempts(new HashSet<>());
        StudentAttempt attempt = new StudentAttempt();
        attempt.setId("attempt-1");
        attempt.setRegistration(r);
        AiEvaluationProcess process = new AiEvaluationProcess();
        process.setId("p1");
        process.setStudentAttempt(attempt);
        when(processes.findByIdWithStudentAttempt("p1")).thenReturn(Optional.of(process));
        AiQuestionEvaluation verdict = new AiQuestionEvaluation();
        verdict.setId("aiqe-1");
        verdict.setMaxMarks(BigDecimal.TEN);
        when(tracking.findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc("p1", "q1")).thenReturn(List.of(verdict));
        Question q = new Question();
        q.setId("q1");
        when(marks.findAllByAttemptIdAndQuestionId("attempt-1", "q1")).thenReturn(List.of(
                QuestionWiseMarks.builder().id("a").question(q).sectionId("sec-a").build(),
                QuestionWiseMarks.builder().id("b").question(q).sectionId("sec-b").build()));

        service.overrideQuestion("p1", "q1", 12.0, "Well argued", "teacher-1");

        // verdict: clamped to its max, edited by the teacher
        assertThat(verdict.getMarksAwarded()).isEqualByComparingTo("10");
        assertThat(verdict.getIsEdited()).isTrue();
        assertThat(verdict.getEditedBy()).isEqualTo("teacher-1");
        assertThat(verdict.getFeedback()).isEqualTo("Well argued");
        var order = inOrder(attempts, tracking, writer);
        order.verify(attempts).lockById("attempt-1");
        order.verify(tracking).save(verdict);
        ArgumentCaptor<List<MarkWriter.MarkChange>> changes = ArgumentCaptor.forClass(List.class);
        order.verify(writer).applyAll(eq("attempt-1"), changes.capture(), any());
        assertThat(changes.getValue()).extracting(MarkWriter.MarkChange::sectionId).containsExactly("sec-a", "sec-b");
        assertThat(changes.getValue()).allSatisfy(c -> {
            assertThat(c.writer()).isEqualTo(MarkWriter.Writer.LEGACY_REVIEW_PUT);
            assertThat(c.marks()).isEqualTo(10.0);
            assertThat(c.aiEvaluationId()).isEqualTo("aiqe-1");
            assertThat(c.feedback()).isEqualTo("Well argued");
        });
        // the old per-run total formula is gone: MarkWriter recomputes (R6)
        verify(typed, never()).attemptTotal(any(), any());
        verify(attempts, never()).save(any());
    }
}
