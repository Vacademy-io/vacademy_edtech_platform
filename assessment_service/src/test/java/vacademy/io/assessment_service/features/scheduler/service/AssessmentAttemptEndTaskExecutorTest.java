package vacademy.io.assessment_service.features.scheduler.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationSubmissionEnqueuer;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.TypedAnswerEvaluation;
import vacademy.io.common.scheduler.entity.SchedulerActivityLog;
import vacademy.io.common.scheduler.repository.TaskExecutionAuditRepository;
import vacademy.io.common.scheduler.service.SchedulingService;

import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The hourly sweep that ends attempts whose clock ran out. It must leave
 * practice tests and surveys alone (they have no clock) and must not treat
 * "no duration" as a deadline that passed at the start.
 */
class AssessmentAttemptEndTaskExecutorTest {

    private StudentAttemptService attempts;
    private AssessmentAttemptEndTaskExecutor executor;
    private AiEvaluationSubmissionEnqueuer enqueuer;
    private TypedAnswerEvaluation typed;

    @BeforeEach
    void setUp() {
        attempts = mock(StudentAttemptService.class);
        executor = new AssessmentAttemptEndTaskExecutor();
        ReflectionTestUtils.setField(executor, "studentAttemptService", attempts);
        ReflectionTestUtils.setField(executor, "schedulingService", mock(SchedulingService.class));
        ReflectionTestUtils.setField(executor, "taskExecutionAuditRepository", mock(TaskExecutionAuditRepository.class));
        enqueuer = mock(AiEvaluationSubmissionEnqueuer.class);
        typed = mock(TypedAnswerEvaluation.class);
        ReflectionTestUtils.setField(executor, "aiEvaluationSubmissionEnqueuer", enqueuer);
        ReflectionTestUtils.setField(executor, "typedAnswerEvaluation", typed);
    }

    private static StudentAttempt attempt(String id, Integer maxTimeMinutes, long startedMinutesAgo) {
        StudentAttempt sa = new StudentAttempt();
        AssessmentUserRegistration registration = new AssessmentUserRegistration();
        Assessment assessment = new Assessment();
        assessment.setAiEvaluationEnabled(true);
        registration.setAssessment(assessment);
        sa.setRegistration(registration);
        sa.setId(id);
        sa.setMaxTime(maxTimeMinutes);
        sa.setStartTime(new Date(System.currentTimeMillis() - startedMinutesAgo * 60_000L));
        return sa;
    }

    @Test
    void onlyATimedAttemptPastItsClockIsEnded() {
        StudentAttempt expiredExam = attempt("exam-expired", 60, 90);
        StudentAttempt runningExam = attempt("exam-running", 60, 10);
        StudentAttempt noDuration = attempt("exam-no-duration", 0, 500);
        StudentAttempt nullDuration = attempt("exam-null-duration", null, 500);
        StudentAttempt practice = attempt("practice", 20, 500);      // duration set, but untimed type
        when(attempts.getAllLiveAttempt()).thenReturn(List.of(expiredExam, runningExam, noDuration, nullDuration, practice));
        when(attempts.getOpenUntimedAttemptIds()).thenReturn(Set.of("practice"));

        executor.execute(new SchedulerActivityLog(), "TEST");

        verify(attempts).updateStudentAttemptResultAfterMarksCalculationAsync(eq(Optional.of(expiredExam)), eq("TIME_EXPIRED"));
        verify(attempts, never()).updateStudentAttemptResultAfterMarksCalculationAsync(eq(Optional.of(runningExam)), any());
        verify(attempts, never()).updateStudentAttemptResultAfterMarksCalculationAsync(eq(Optional.of(noDuration)), any());
        verify(attempts, never()).updateStudentAttemptResultAfterMarksCalculationAsync(eq(Optional.of(nullDuration)), any());
        verify(attempts, never()).updateStudentAttemptResultAfterMarksCalculationAsync(eq(Optional.of(practice)), any());
    }

    @Test
    void aTimedOutOnlineAttemptIsQueuedForAiLikeASubmittedOne() {
        StudentAttempt expiredEssay = attempt("essay-expired", 60, 90);
        StudentAttempt expiredUpload = attempt("upload-expired", 60, 90);
        when(attempts.getAllLiveAttempt()).thenReturn(List.of(expiredEssay, expiredUpload));
        when(attempts.getOpenUntimedAttemptIds()).thenReturn(Set.of());
        when(typed.isTypedAttempt(eq(expiredEssay), any())).thenReturn(true);
        when(typed.isTypedAttempt(eq(expiredUpload), any())).thenReturn(false);

        executor.execute(new SchedulerActivityLog(), "TEST");

        verify(enqueuer).enqueueIfEnabled(eq(expiredEssay), any());
        verify(enqueuer, never()).enqueueIfEnabled(eq(expiredUpload), any());
    }

    @Test
    void anAssessmentThatNeverOptedInIsNotEvenChecked() {
        StudentAttempt expired = attempt("exam-expired", 60, 90);
        expired.getRegistration().getAssessment().setAiEvaluationEnabled(null);
        when(attempts.getAllLiveAttempt()).thenReturn(List.of(expired));
        when(attempts.getOpenUntimedAttemptIds()).thenReturn(Set.of());

        executor.execute(new SchedulerActivityLog(), "TEST");

        verify(typed, never()).isTypedAttempt(any(), any());
        verify(enqueuer, never()).enqueueIfEnabled(any(), any());
    }
}
