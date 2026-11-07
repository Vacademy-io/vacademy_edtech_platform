package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.TypedAnswerEvaluation;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

/**
 * A submitted attempt on a manually-evaluated assessment is HELD, explicitly.
 *
 * Nothing automatic ever releases these, so leaving the release status NULL
 * meant the attempt never appeared on the learner's Reports list (it filters
 * on RELEASED/PENDING) and read "Not available" for the admin. The hold must
 * not touch an attempt that is already RELEASED and merely being re-calculated.
 */
class StudentAttemptServiceManualHoldTest {

    private static StudentAttempt attempt(String evaluationType, String releaseStatus) {
        Assessment a = new Assessment();
        a.setEvaluationType(evaluationType);
        a.setResultType("MANUAL");
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(a);
        StudentAttempt sa = new StudentAttempt();
        sa.setId("att-1");
        sa.setRegistration(r);
        sa.setStatus("ENDED");
        sa.setReportReleaseStatus(releaseStatus);
        return sa;
    }

    private static StudentAttempt run(StudentAttempt sa) {
        return run(sa, false);
    }

    private static StudentAttempt run(StudentAttempt sa, boolean awaitsAiGrading) {
        StudentAttemptService service = spy(new StudentAttemptService());
        TypedAnswerEvaluation typed = mock(TypedAnswerEvaluation.class);
        when(typed.awaitsAiGrading(any(), any())).thenReturn(awaitsAiGrading);
        ReflectionTestUtils.setField(service, "typedAnswerEvaluation", typed);
        doReturn(0.0).when(service).calculateTotalMarksForAttemptAndUpdateQuestionWiseMarks(any());
        AttemptDataParserService parser = mock(AttemptDataParserService.class);
        when(parser.getTimeElapsedInSecondsFromAttemptData(any())).thenReturn(0L);
        StudentAttemptRepository repo = mock(StudentAttemptRepository.class);
        when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        ReflectionTestUtils.setField(service, "attemptDataParserService", parser);
        ReflectionTestUtils.setField(service, "studentAttemptRepository", repo);
        ReflectionTestUtils.setField(service, "assessmentWorkflowEventPublisher",
                mock(AssessmentWorkflowEventPublisher.class));
        return service.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(sa), null);
    }

    @Test
    void aManualEvaluationSubmitHoldsTheReport() {
        StudentAttempt saved = run(attempt("MANUAL", null));
        assertThat(saved.getResultStatus()).isEqualTo("PENDING");
        assertThat(saved.getReportReleaseStatus()).isEqualTo("PENDING");
    }

    @Test
    void anAlreadyReleasedAttemptStaysReleasedWhenRecalculated() {
        StudentAttempt saved = run(attempt("MANUAL", "RELEASED"));
        assertThat(saved.getReportReleaseStatus()).isEqualTo("RELEASED");
    }

    @Test
    void anOnlineAttemptTheAiWillGradeIsHeldInsteadOfAutoReleased() {
        // Essay typed in the player on an "auto after submission" assessment with
        // AI evaluation on: the word-overlap score must not be published.
        StudentAttempt sa = attempt("AUTO", null);
        sa.getRegistration().getAssessment().setResultType("AUTO_AFTER_SUBMISSION");
        StudentAttempt saved = run(sa, true);
        assertThat(saved.getResultStatus()).isEqualTo("PENDING");
        assertThat(saved.getReportReleaseStatus()).isEqualTo("PENDING");
        // result_marks is still written for an AUTO attempt, as the release path expects.
        assertThat(saved.getResultMarks()).isEqualTo(0.0);
    }

    @Test
    void theSameAttemptWithoutAiIsReleasedOnSubmitAsBefore() {
        StudentAttempt sa = attempt("AUTO", null);
        sa.getRegistration().getAssessment().setResultType("AUTO_AFTER_SUBMISSION");
        StudentAttempt saved = run(sa, false);
        assertThat(saved.getResultStatus()).isEqualTo("COMPLETED");
        assertThat(saved.getReportReleaseStatus()).isEqualTo("RELEASED");
    }

    @Test
    void anAutoEvaluatedAssessmentIsNotTouchedByTheHold() {
        // AUTO evaluation with a MANUAL result type: release is the admin's call,
        // and the status the auto path leaves is whatever autoRelease decides.
        StudentAttempt saved = run(attempt("AUTO", null));
        assertThat(saved.getResultStatus()).isEqualTo("COMPLETED");
        assertThat(saved.getReportReleaseStatus()).isNull();
    }
}
