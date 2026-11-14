package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.TypedAnswerEvaluation;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A result released on submit queues its email for AutoResultReleaseJob (result_notice_pending),
 * after the submission commits, and only on the submit that actually released it.
 */
class StudentAttemptServiceResultNoticeTest {

    private final StudentAttemptRepository repo = mock(StudentAttemptRepository.class);

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    private static StudentAttempt attempt(String evaluationType, String resultType, String releaseStatus) {
        Assessment a = new Assessment();
        a.setEvaluationType(evaluationType);
        a.setResultType(resultType);
        a.setPlayMode("EXAM");
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(a);
        StudentAttempt sa = new StudentAttempt();
        sa.setId("att-1");
        sa.setRegistration(r);
        sa.setStatus("ENDED");
        sa.setReportReleaseStatus(releaseStatus);
        return sa;
    }

    private StudentAttempt run(StudentAttempt sa) {
        StudentAttemptService service = spy(new StudentAttemptService());
        TypedAnswerEvaluation typed = mock(TypedAnswerEvaluation.class);
        when(typed.awaitsAiGrading(any(), any())).thenReturn(false);
        ReflectionTestUtils.setField(service, "typedAnswerEvaluation", typed);
        doReturn(0.0).when(service).calculateTotalMarksForAttemptAndUpdateQuestionWiseMarks(any());
        AttemptDataParserService parser = mock(AttemptDataParserService.class);
        when(parser.getTimeElapsedInSecondsFromAttemptData(any())).thenReturn(0L);
        when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        ReflectionTestUtils.setField(service, "attemptDataParserService", parser);
        ReflectionTestUtils.setField(service, "studentAttemptRepository", repo);
        ReflectionTestUtils.setField(service, "assessmentWorkflowEventPublisher",
                mock(AssessmentWorkflowEventPublisher.class));
        return service.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(sa), null);
    }

    @Test
    void a_release_on_submit_queues_the_result_email() {
        run(attempt("AUTO", "AUTO_AFTER_SUBMISSION", null));
        verify(repo).markResultNoticePending("att-1");
    }

    @Test
    void a_recalculation_of_an_already_released_attempt_queues_nothing() {
        run(attempt("AUTO", "AUTO_AFTER_SUBMISSION", "RELEASED"));
        verify(repo, never()).markResultNoticePending(anyString());
    }

    @Test
    void a_held_result_queues_nothing() {
        run(attempt("AUTO", "MANUAL", null));
        run(attempt("MANUAL", "AUTO_AFTER_SUBMISSION", null));
        verify(repo, never()).markResultNoticePending(anyString());
    }

    @Test
    void a_mock_or_practice_attempt_is_not_emailed_per_attempt() {
        StudentAttempt mock = attempt("AUTO", "AUTO_AFTER_SUBMISSION", null);
        mock.getRegistration().getAssessment().setPlayMode("MOCK");
        StudentAttempt saved = run(mock);
        verify(repo, never()).markResultNoticePending(anyString());
        // still released on submit, as before
        org.assertj.core.api.Assertions.assertThat(saved.getReportReleaseStatus()).isEqualTo("RELEASED");

        StudentAttempt practice = attempt("AUTO", "AUTO_AFTER_ASSESSMENT_END", null);
        practice.getRegistration().getAssessment().setPlayMode("PRACTICE");
        run(practice);
        verify(repo, never()).markResultNoticePending(anyString());
    }

    @Test
    void inside_a_transaction_it_waits_for_the_commit() {
        TransactionSynchronizationManager.initSynchronization();

        run(attempt("AUTO", "AUTO_AFTER_SUBMISSION", null));
        verify(repo, never()).markResultNoticePending(anyString());

        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        verify(repo).markResultNoticePending("att-1");
    }

    @Test
    void a_failure_to_queue_does_not_fail_the_submission() {
        doThrow(new IllegalStateException("db")).when(repo).markResultNoticePending(anyString());
        StudentAttempt saved = run(attempt("AUTO", "AUTO_AFTER_SUBMISSION", null));
        org.assertj.core.api.Assertions.assertThat(saved.getReportReleaseStatus()).isEqualTo("RELEASED");
    }
}
