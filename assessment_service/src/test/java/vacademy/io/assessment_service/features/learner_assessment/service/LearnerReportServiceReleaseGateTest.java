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
    void aHeldResultIsARefusalNotAServerFailure() {
        // A 5xx here goes to Sentry as an error every time a learner opens a held report.
        assertThatThrownBy(() -> access(attempt("NO_AUTO_RELEASE", null)))
                .isInstanceOfSatisfying(VacademyException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(org.springframework.http.HttpStatus.FORBIDDEN));
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
    private static StudentAttempt afterEnd(String playMode, java.util.Date end, String releaseStatus) {
        StudentAttempt sa = attempt("AUTO_AFTER_ASSESSMENT_END", releaseStatus);
        sa.getRegistration().getAssessment().setPlayMode(playMode);
        sa.getRegistration().getAssessment().setBoundEndTime(end);
        return sa;
    }

    private static boolean heldAt(StudentAttempt sa, java.util.Date now) {
        return LearnerReportService.isHeldUntilAssessmentEnd(sa.getRegistration().getAssessment(), sa, now);
    }

    @Test
    void afterEndResultIsRefusedWhileTheAssessmentIsStillOpen() {
        // Submitted before the end date: the report must not open until the window closes.
        java.util.Date end = new java.util.Date(System.currentTimeMillis() + 3_600_000L);
        assertThatThrownBy(() -> access(afterEnd("EXAM", end, null)))
                .isInstanceOfSatisfying(VacademyException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(org.springframework.http.HttpStatus.FORBIDDEN));
    }

    @Test
    void afterEndResultIsServedOnceTheEndDatePasses() {
        // Before the hourly release job has run - the status is still NULL.
        java.util.Date end = new java.util.Date(System.currentTimeMillis() - 1000L);
        access(afterEnd("EXAM", end, null));
    }

    @Test
    void afterEndHoldRule() {
        java.util.Date end = new java.util.Date(1_800_000_000_000L);
        java.util.Date before = new java.util.Date(end.getTime() - 60_000L);
        java.util.Date after = new java.util.Date(end.getTime() + 1000L);

        assertThat(heldAt(afterEnd("EXAM", end, null), before)).isTrue();
        assertThat(heldAt(afterEnd("EXAM", end, null), after)).isFalse();
        // Released early by the admin: shown.
        assertThat(heldAt(afterEnd("EXAM", end, "RELEASED"), before)).isFalse();
        // Mock and practice are released on submission - they never end.
        assertThat(heldAt(afterEnd("MOCK", end, null), before)).isFalse();
        assertThat(heldAt(afterEnd("practice", end, null), before)).isFalse();
        // No end date, or the 9999 sentinel: nothing to wait for.
        assertThat(heldAt(afterEnd("EXAM", null, null), before)).isFalse();
        java.util.Date sentinel = java.util.Date.from(java.time.Instant.parse("9999-12-31T23:59:59Z"));
        assertThat(heldAt(afterEnd("EXAM", sentinel, null), before)).isFalse();
        // Other result types are untouched by this rule.
        StudentAttempt submission = attempt("AUTO_AFTER_SUBMISSION", null);
        assertThat(LearnerReportService.isHeldUntilAssessmentEnd(
                submission.getRegistration().getAssessment(), submission, before)).isFalse();
    }
}
