package vacademy.io.assessment_service.features.learner_assessment.service;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The learner report endpoints (detail, comparison, annotated copy, PDF) must
 * refuse a MANUAL-result attempt that has not been released — the same rule the
 * learner UI applies — and any attempt explicitly held PENDING for a teacher;
 * other AUTO results are served as before.
 */
class LearnerReportServiceReleaseGateTest {

    private static StudentAttempt attempt(String resultType, String releaseStatus) {
        Assessment a = new Assessment();
        a.setId("asmt-1");
        a.setResultType(resultType);
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setId("reg-1");
        r.setAssessment(a);
        StudentAttempt sa = new StudentAttempt();
        sa.setId("att-1");
        sa.setRegistration(r);
        sa.setReportReleaseStatus(releaseStatus);
        return sa;
    }

    private static void access(StudentAttempt sa) {
        AssessmentUserRegistrationRepository regs = mock(AssessmentUserRegistrationRepository.class);
        when(regs.findTopByUserIdAndAssessmentId("user-1", "asmt-1")).thenReturn(Optional.of(sa.getRegistration()));
        StudentAttemptRepository attempts = mock(StudentAttemptRepository.class);
        when(attempts.findById("att-1")).thenReturn(Optional.of(sa));
        LearnerReportService service = new LearnerReportService();
        ReflectionTestUtils.setField(service, "registrationRepository", regs);
        ReflectionTestUtils.setField(service, "studentAttemptRepository", attempts);
        ReflectionTestUtils.invokeMethod(service, "validateOwnershipAndAccess", "user-1", "asmt-1", "att-1");
    }

    @Test
    void aHeldManualResultIsRefused() {
        assertThatThrownBy(() -> access(attempt("MANUAL", "PENDING")))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("not been released");
        assertThatThrownBy(() -> access(attempt("MANUAL", null)))
                .isInstanceOf(VacademyException.class);
    }

    @Test
    void aReleasedManualResultIsServed() {
        access(attempt("MANUAL", "RELEASED"));
    }

    @Test
    void anUnreleasedNoAutoReleaseResultIsRefused() {
        assertThatThrownBy(() -> access(attempt("NO_AUTO_RELEASE", null)))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("not been released");
        access(attempt("NO_AUTO_RELEASE", "RELEASED"));
    }

    @Test
    void autoResultTypesAreNotGatedHere() {
        // The card offers "Show report" for these unless the attempt is held.
        access(attempt("AUTO_AFTER_SUBMISSION", null));
        access(attempt("AUTO_AFTER_ASSESSMENT_END", "RELEASED"));
        access(attempt(null, null));
    }

    @Test
    void anAutoResultHeldPendingForATeacherIsRefused() {
        // Typed answers the AI is grading: held until the teacher releases.
        assertThatThrownBy(() -> access(attempt("AUTO_AFTER_SUBMISSION", "PENDING")))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("not been released");
    }

    @Test
    void theRuleItself() {
        assertThat(LearnerReportService.isHeldManualResult(attempt("MANUAL", "PENDING").getRegistration().getAssessment(),
                attempt("MANUAL", "PENDING"))).isTrue();
        assertThat(LearnerReportService.isHeldManualResult(null, attempt("MANUAL", null))).isFalse();
    }
}
