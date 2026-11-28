package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.util.ReflectionTestUtils;
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
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.submission_review.service.ReviewEvents;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionSnapshots;

import java.math.BigDecimal;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Contract 7.3: the AI never overwrites a person's mark, never changes a released result, and locks first. */
class AiCallbackGuardTest {

    private AiEvaluationProcessRepository processes;
    private AiQuestionEvaluationRepository tracking;
    private QuestionWiseMarksRepository marks;
    private StudentAttemptRepository attempts;
    private TypedAnswerEvaluation typed;
    private CopyCheckCallbackService service;
    private StudentAttempt attempt;
    private AiEvaluationProcess process;

    @BeforeEach
    void setUp() {
        processes = mock(AiEvaluationProcessRepository.class);
        tracking = mock(AiQuestionEvaluationRepository.class);
        marks = mock(QuestionWiseMarksRepository.class);
        attempts = mock(StudentAttemptRepository.class);
        typed = mock(TypedAnswerEvaluation.class);
        service = new CopyCheckCallbackService(processes, mock(CopyIntakeService.class), tracking,
                mock(CopyCheckLayoutRepository.class), marks, attempts, mock(AiEvaluationCancellationService.class),
                typed, new ObjectMapper());
        Assessment exam = new Assessment();
        exam.setId("a1");
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(exam);
        r.setStudentAttempts(new HashSet<>());
        attempt = new StudentAttempt();
        attempt.setId("attempt-1");
        attempt.setRegistration(r);
        attempt.setStatus("ENDED");
        process = new AiEvaluationProcess();
        process.setId("p1");
        process.setStatus("EVALUATING");
        process.setStudentAttempt(attempt);
        when(processes.findById("p1")).thenReturn(Optional.of(process));
        when(attempts.findById("attempt-1")).thenReturn(Optional.of(attempt));
        AiQuestionEvaluation tracked = new AiQuestionEvaluation();
        tracked.setId("aiqe-1");
        tracked.setStatus("PENDING");
        when(tracking.findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc("p1", "q1"))
                .thenReturn(List.of(tracked));
        when(tracking.save(any())).thenAnswer(i -> i.getArgument(0));
    }

    private static QuestionWiseMarks row(String source, double value) {
        Question q = new Question();
        q.setId("q1");
        return QuestionWiseMarks.builder().id("r1").question(q).sectionId("s1").marks(value).marksSource(source)
                .status("PENDING").revision(2).build();
    }

    private void verdict() {
        service.onQuestionDone(CopyCheckCallbackDto.QuestionDone.builder().processId("p1").questionId("q1")
                .status("COMPLETED").marksAwarded(3.0).maxMarks(10.0).build());
    }

    @Test
    void ai_does_not_overwrite_a_teacher_mark_but_keeps_its_verdict() {
        QuestionWiseMarks teacher = row("MANUAL", 8.0);
        when(marks.findAllByAttemptIdAndQuestionId("attempt-1", "q1")).thenReturn(List.of(teacher));
        verdict();
        assertThat(teacher.getMarks()).isEqualTo(8.0);
        assertThat(teacher.getMarksSource()).isEqualTo("MANUAL");
        verify(marks, never()).save(any());
        verify(tracking).save(any());
        verify(attempts).lockById("attempt-1");
    }

    @Test
    void ai_does_not_change_a_released_result() {
        attempt.setReportReleaseStatus("RELEASED");
        QuestionWiseMarks legacy = row(null, 0.0);
        when(marks.findAllByAttemptIdAndQuestionId("attempt-1", "q1")).thenReturn(List.of(legacy));
        verdict();
        assertThat(legacy.getMarks()).isEqualTo(0.0);
        verify(marks, never()).save(any());
    }

    @Test
    void ai_mark_on_an_open_row_is_a_draft_linked_to_its_verdict() {
        QuestionWiseMarks open = row(null, 0.0);
        open.setMarkState("NEEDS_MARKING");
        when(marks.findAllByAttemptIdAndQuestionId("attempt-1", "q1")).thenReturn(List.of(open));
        verdict();
        assertThat(open.getMarks()).isEqualTo(3.0);
        assertThat(open.getMarksSource()).isEqualTo("AI");
        assertThat(open.getMarkState()).isNull();
        assertThat(open.getAiQuestionEvaluationId()).isEqualTo("aiqe-1");
        assertThat(open.getRevision()).isEqualTo(3);
    }

    /** Live follow-up B1: the mirrored AI mark also moves the legacy status off PENDING ("skipped"). */
    @Test
    void ai_mark_sets_the_legacy_status_from_the_mark() {
        QuestionWiseMarks open = row(null, 0.0);
        when(marks.findAllByAttemptIdAndQuestionId("attempt-1", "q1")).thenReturn(List.of(open));
        verdict(); // 3 of 10
        assertThat(open.getStatus()).isEqualTo("PARTIAL_CORRECT");

        QuestionWiseMarks full = row(null, 0.0);
        when(marks.findAllByAttemptIdAndQuestionId("attempt-1", "q1")).thenReturn(List.of(full));
        service.onQuestionDone(CopyCheckCallbackDto.QuestionDone.builder().processId("p1").questionId("q1")
                .status("COMPLETED").marksAwarded(10.0).maxMarks(10.0).build());
        assertThat(full.getStatus()).isEqualTo("CORRECT");

        QuestionWiseMarks zero = row(null, 0.0);
        when(marks.findAllByAttemptIdAndQuestionId("attempt-1", "q1")).thenReturn(List.of(zero));
        service.onQuestionDone(CopyCheckCallbackDto.QuestionDone.builder().processId("p1").questionId("q1")
                .status("COMPLETED").marksAwarded(0.0).maxMarks(10.0).extractedAnswer("Water boils at 50").build());
        assertThat(zero.getStatus()).isEqualTo("INCORRECT");
    }

    /**
     * Review issue B1-blank-ai-zero-now-incorrect: ai_service's verdict for a blank answer
     * (typed_answers.unattempted_verdict: 0 marks, extracted_answer "", status COMPLETED)
     * keeps the row PENDING, which the learner report counts as skipped, not wrong.
     */
    @Test
    void ai_no_answer_verdict_keeps_the_row_skipped() {
        QuestionWiseMarks blank = row(null, 0.0);
        blank.setStatus("PENDING");
        when(marks.findAllByAttemptIdAndQuestionId("attempt-1", "q1")).thenReturn(List.of(blank));
        service.onQuestionDone(CopyCheckCallbackDto.QuestionDone.builder().processId("p1").questionId("q1")
                .status("COMPLETED").marksAwarded(0.0).maxMarks(10.0).extractedAnswer("")
                .feedback("No answer was submitted for this question.").build());
        assertThat(blank.getStatus()).isEqualTo("PENDING");
        assertThat(blank.getMarks()).isZero();
        assertThat(blank.getMarksSource()).isEqualTo("AI");
    }

    @Test
    void run_total_is_the_review_total_when_a_teacher_marked_a_graded_question() {
        SubmissionReleaseService release = mock(SubmissionReleaseService.class);
        SubmissionReviewStore store = mock(SubmissionReviewStore.class);
        ReflectionTestUtils.setField(service, "submissionReleaseService", release);
        ReflectionTestUtils.setField(service, "submissionReviewStore", store);
        AiQuestionEvaluation graded = new AiQuestionEvaluation();
        Question q = new Question();
        q.setId("q1");
        graded.setQuestion(q);
        graded.setStatus("COMPLETED");
        graded.setMarksAwarded(BigDecimal.valueOf(3));
        when(tracking.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of(graded));
        when(typed.attemptTotal(any(), any())).thenReturn(3.0);
        when(marks.findByStudentAttemptId("attempt-1")).thenReturn(List.of(row("MANUAL", 8.0)));
        var state = new SubmissionReviewStore.AttemptState("attempt-1", "ENDED", "PENDING", null, 3.0, "EVALUATING",
                0, null, null, false, null, new Date());
        when(store.attempt("attempt-1")).thenReturn(state);
        SubmissionSnapshots.Snapshot snap = new SubmissionSnapshots.Snapshot(List.of(),
                new SubmissionSnapshots.Counts(0, 0, 0, 1, 0, 0, 0), 8.0, 10.0, "COMPLETED", false, 0);
        when(release.snapshot(attempt, state)).thenReturn(snap);

        service.onComplete(CopyCheckCallbackDto.Complete.builder().processId("p1").build());

        ArgumentCaptor<StudentAttempt> saved = ArgumentCaptor.forClass(StudentAttempt.class);
        verify(attempts).save(saved.capture());
        assertThat(saved.getValue().getTotalMarks()).isEqualTo(8.0);
    }

    @Test
    void completed_run_on_a_release_when_marked_attempt_asks_for_the_release() {
        ApplicationEventPublisher publisher = mock(ApplicationEventPublisher.class);
        ReflectionTestUtils.setField(service, "eventPublisher", publisher);
        ReflectionTestUtils.setField(attempt, "releaseWhenMarked", Boolean.TRUE);
        AiQuestionEvaluation graded = new AiQuestionEvaluation();
        graded.setStatus("COMPLETED");
        graded.setMarksAwarded(BigDecimal.ONE);
        when(tracking.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of(graded));
        service.onComplete(CopyCheckCallbackDto.Complete.builder().processId("p1").build());
        verify(publisher).publishEvent(any(ReviewEvents.AttemptReadyForRelease.class));
    }

    /** Review 1 #3: the run-complete callback locks the attempt BEFORE it writes the run row. */
    @Test
    void complete_callback_locks_the_attempt_before_saving_the_run() {
        when(tracking.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of());
        service.onComplete(CopyCheckCallbackDto.Complete.builder().processId("p1").build());
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(attempts, processes);
        order.verify(attempts).lockById("attempt-1");
        order.verify(processes).save(process);
    }

    /** Review 2 #4: a CBE-only run on an AI-off test stays EVALUATING but a flagged attempt still asks. */
    @Test
    void held_run_on_a_flagged_attempt_still_asks_for_the_release() {
        ApplicationEventPublisher publisher = mock(ApplicationEventPublisher.class);
        ReflectionTestUtils.setField(service, "eventPublisher", publisher);
        ReflectionTestUtils.setField(attempt, "releaseWhenMarked", Boolean.TRUE);
        AiQuestionEvaluation graded = new AiQuestionEvaluation();
        graded.setStatus("COMPLETED");
        graded.setMarksAwarded(BigDecimal.ONE);
        when(tracking.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of(graded));
        when(typed.gradesCbeOnly(any())).thenReturn(true);
        service.onComplete(CopyCheckCallbackDto.Complete.builder().processId("p1").build());
        assertThat(attempt.getResultStatus()).isEqualTo("EVALUATING");
        verify(publisher).publishEvent(any(ReviewEvents.AttemptReadyForRelease.class));
    }
}
