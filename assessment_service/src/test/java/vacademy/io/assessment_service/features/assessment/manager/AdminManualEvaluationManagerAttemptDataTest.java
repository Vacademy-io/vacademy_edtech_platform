package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The answer sheet of an attempt is read by the evaluator, the submissions list and
 * the AI review page. A copy checked without a student never reaches ENDED, so a
 * guard on ENDED alone refused it, and a refusal must stay a 4xx: a server error
 * status is what turns an expected "not submitted yet" into a Sentry issue.
 */
class AdminManualEvaluationManagerAttemptDataTest {

    private StudentAttemptService attempts;
    private AdminManualEvaluationManager manager;

    @BeforeEach
    void setUp() {
        attempts = mock(StudentAttemptService.class);
        manager = new AdminManualEvaluationManager();
        ReflectionTestUtils.setField(manager, "studentAttemptService", attempts);
    }

    private StudentAttempt attempt(String status, String attemptData) {
        StudentAttempt attempt = new StudentAttempt();
        attempt.setStatus(status);
        attempt.setAttemptData(attemptData);
        when(attempts.getStudentAttemptById("a1")).thenReturn(Optional.of(attempt));
        return attempt;
    }

    @Test
    void aCheckOnlyCopyGivesItsAnswerSheet() {
        attempt(CopyIntakeService.COPY_CHECK_ATTEMPT_STATUS, "{\"fileId\":\"f1\"}");

        assertThat(manager.getAttemptData(null, "a1", false).getBody()).isEqualTo("f1");
    }

    @Test
    void anEndedAttemptStillGivesItsAnswerSheet() {
        attempt("ENDED", "{\"fileId\":\"f1\"}");

        assertThat(manager.getAttemptData(null, "a1", false).getBody()).isEqualTo("f1");
    }

    @Test
    void aCheckOnlyCopyFallsBackToItsEvaluatedFile() {
        attempt(CopyIntakeService.COPY_CHECK_ATTEMPT_STATUS, null).setEvaluatedFileId("f2");

        assertThat(manager.getAttemptData(null, "a1", false).getBody()).isEqualTo("f2");
    }

    @Test
    void anAttemptStillInProgressIsABadRequestThatNamesItsStatus() {
        attempt("LIVE", "{\"fileId\":\"f1\"}");

        assertThatThrownBy(() -> manager.getAttemptData(null, "a1", true))
                .isInstanceOfSatisfying(VacademyException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(e.getMessage()).contains("LIVE").doesNotStartWith("Failed");
                });
        verify(attempts, never()).updateStudentAttempt(any());
    }

    @Test
    void anAttemptWithNoStatusIsRefusedNotACrash() {
        attempt(null, null);

        assertThatThrownBy(() -> manager.getAttemptData(null, "a1", false))
                .isInstanceOfSatisfying(VacademyException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void aMissingAttemptIsNotFound() {
        when(attempts.getStudentAttemptById("a1")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> manager.getAttemptData(null, "a1", false))
                .isInstanceOfSatisfying(VacademyException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }
}
