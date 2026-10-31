package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;

import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * When a learner gets to see their result, by assessment type.
 *
 * "Auto after assessment end" on a mock or practice test used to mean never:
 * those windows close in the year 9999. Exams keep the real rule.
 */
class StudentAttemptServiceReleaseTest {

    private static final Date FAR_FUTURE = new Date(253402300799000L);   // 9999-12-31

    private static StudentAttempt attempt(String playMode, String resultType, Date boundEnd) {
        Assessment a = new Assessment();
        a.setPlayMode(playMode);
        a.setResultType(resultType);
        a.setBoundEndTime(boundEnd);
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(a);
        StudentAttempt sa = new StudentAttempt();
        sa.setRegistration(r);
        return sa;
    }

    private static boolean release(StudentAttempt attempt) {
        StudentAttemptService service = new StudentAttemptService();
        Boolean released = ReflectionTestUtils.invokeMethod(service, "autoReleaseResultIfApplicable", attempt);
        return Boolean.TRUE.equals(released);
    }

    @Test
    void aMockSetToReleaseAtTheEndReleasesOnSubmissionInstead() {
        StudentAttempt sa = attempt("MOCK", "AUTO_AFTER_ASSESSMENT_END", FAR_FUTURE);
        assertThat(release(sa)).isTrue();
        assertThat(sa.getReportReleaseStatus()).isEqualTo("RELEASED");
    }

    @Test
    void aPracticeTestSetToReleaseAtTheEndReleasesOnSubmissionInstead() {
        assertThat(release(attempt("PRACTICE", "AUTO_AFTER_ASSESSMENT_END", FAR_FUTURE))).isTrue();
    }

    @Test
    void aLiveExamStillWaitsForItsWindowToClose() {
        StudentAttempt open = attempt("EXAM", "AUTO_AFTER_ASSESSMENT_END", new Date(System.currentTimeMillis() + 3_600_000));
        assertThat(release(open)).isFalse();
        assertThat(open.getReportReleaseStatus()).isNull();

        StudentAttempt closed = attempt("EXAM", "AUTO_AFTER_ASSESSMENT_END", new Date(System.currentTimeMillis() - 1000));
        assertThat(release(closed)).isTrue();
    }

    @Test
    void manualAndHeldResultsAreNeverAutoReleased() {
        assertThat(release(attempt("MOCK", "MANUAL", FAR_FUTURE))).isFalse();
        assertThat(release(attempt("PRACTICE", "NO_AUTO_RELEASE", FAR_FUTURE))).isFalse();
    }

    @Test
    void afterSubmissionReleasesForEveryType() {
        assertThat(release(attempt("EXAM", "AUTO_AFTER_SUBMISSION", FAR_FUTURE))).isTrue();
        assertThat(release(attempt("SURVEY", "AUTO_AFTER_SUBMISSION", FAR_FUTURE))).isTrue();
    }
}
