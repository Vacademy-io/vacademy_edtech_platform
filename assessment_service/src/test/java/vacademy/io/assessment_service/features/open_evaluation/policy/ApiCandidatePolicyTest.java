package vacademy.io.assessment_service.features.open_evaluation.policy;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.context.SecurityContextHolder;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.common.auth.apikey.ApiKeyAuthentication;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.util.HashSet;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** API exam / API candidate detection, workflow opt-in, and the finalized-result lock. */
class ApiCandidatePolicyTest {

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private static Assessment exam(String source) {
        Assessment a = new Assessment();
        a.setId("a1");
        a.setSource(source);
        return a;
    }

    private static AssessmentUserRegistration registration(Assessment exam, String userId, String sourceId, String email) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setId("r1");
        r.setAssessment(exam);
        r.setUserId(userId);
        r.setSourceId(sourceId);
        r.setUserEmail(email);
        r.setStudentAttempts(new HashSet<>());
        return r;
    }

    private static StudentAttempt attempt(AssessmentUserRegistration r, String releaseStatus) {
        StudentAttempt a = new StudentAttempt();
        a.setId("att-" + releaseStatus);
        a.setRegistration(r);
        a.setReportReleaseStatus(releaseStatus);
        return a;
    }

    @Test
    void api_exam_is_source_api_only() {
        assertThat(ApiCandidatePolicy.isApiExam(exam("API"))).isTrue();
        assertThat(ApiCandidatePolicy.isApiExam(exam(null))).isFalse();
        assertThat(ApiCandidatePolicy.isApiExam(exam("AI_RECORDING"))).isFalse();
        assertThat(ApiCandidatePolicy.isApiExam(null)).isFalse();
    }

    @Test
    void api_candidate_by_source_id_or_synthetic_user_id() {
        Assessment e = exam("API");
        assertThat(ApiCandidatePolicy.isApi(registration(e, "u1", "apikey:k1", ""))).isTrue();
        assertThat(ApiCandidatePolicy.isApi(registration(e, "apic_123", "", ""))).isTrue();
        assertThat(ApiCandidatePolicy.isApi(registration(e, "u1", "batch-7", "a@b.c"))).isFalse();
        assertThat(ApiCandidatePolicy.isApi((AssessmentUserRegistration) null)).isFalse();
    }

    @Test
    void messages_never_go_to_api_candidates_or_blank_addresses() {
        Assessment e = exam(null);
        assertThat(ApiCandidatePolicy.mayMessage(registration(e, "u1", "b", "learner@x.in"))).isTrue();
        assertThat(ApiCandidatePolicy.mayMessage(registration(e, "u1", "b", " "))).isFalse();
        assertThat(ApiCandidatePolicy.mayMessage(registration(e, "apic_1", "apikey:k1", "x@y.z"))).isFalse();
    }

    @Test
    void workflow_events_fire_for_dashboard_exams_and_for_api_exams_only_on_opt_in() {
        ApiInstituteFlags flags = new ApiInstituteFlags();
        assertThat(ApiCandidatePolicy.workflowEventsAllowed(exam(null), "inst-1", flags)).isTrue();
        assertThat(ApiCandidatePolicy.workflowEventsAllowed(exam("API"), "inst-1", flags)).isFalse();
        assertThat(ApiCandidatePolicy.workflowEventsAllowed(exam("API"), "inst-1", null)).isFalse();

        flags.record(ApiKeyPrincipal.builder().keyId("k1").instituteId("inst-1").fireWorkflowEvents(true).build());
        assertThat(ApiCandidatePolicy.workflowEventsAllowed(exam("API"), "inst-1", flags)).isTrue();
        assertThat(ApiCandidatePolicy.workflowEventsAllowed(exam("API"), "inst-2", flags)).isFalse();
    }

    @Test
    void the_current_key_request_wins_over_the_remembered_flag() {
        ApiInstituteFlags flags = new ApiInstituteFlags();
        flags.record(ApiKeyPrincipal.builder().keyId("k1").instituteId("inst-1").fireWorkflowEvents(true).build());
        SecurityContextHolder.getContext().setAuthentication(new ApiKeyAuthentication(
                ApiKeyPrincipal.builder().keyId("k2").instituteId("inst-1").fireWorkflowEvents(false)
                        .status("ACTIVE").build()));
        assertThat(flags.fireWorkflowEvents("inst-1")).isFalse();
    }

    @Test
    void lock_guard_refuses_changes_to_released_attempts() {
        ResultLockGuard guard = new ResultLockGuard();
        Assessment api = exam("API");
        Assessment dashboard = exam(null);
        StudentAttempt releasedApi = attempt(registration(api, "apic_1", "apikey:k1", ""), "RELEASED");
        StudentAttempt pendingApi = attempt(registration(api, "apic_1", "apikey:k1", ""), "PENDING");
        StudentAttempt releasedDashboard = attempt(registration(dashboard, "u1", "b", "x@y.z"), "RELEASED");

        assertThatThrownBy(() -> guard.requireNotFinalized(releasedDashboard)).isInstanceOf(ResultLockedException.class);
        assertThatThrownBy(() -> guard.requireNotFinalizedForApiExam(releasedApi))
                .isInstanceOf(ResultLockedException.class)
                .isInstanceOf(vacademy.io.common.exceptions.ConflictException.class);
        guard.requireNotFinalizedForApiExam(pendingApi);
        guard.requireNotFinalizedForApiExam(releasedDashboard); // dashboard exams keep today's behaviour
        guard.requireNotFinalized(null);

        assertThatThrownBy(() -> guard.requireNoneFinalizedForApiExam(api, List.of(pendingApi, releasedApi)))
                .isInstanceOf(ResultLockedException.class);
        guard.requireNoneFinalizedForApiExam(dashboard, List.of(releasedDashboard));
    }

    @Test
    void lock_guard_checks_existing_attempts_of_a_registration() {
        ResultLockGuard guard = new ResultLockGuard();
        AssessmentUserRegistration reg = registration(exam("API"), "apic_1", "apikey:k1", "");
        guard.requireNoFinalizedAttemptForApiExam(reg);
        reg.getStudentAttempts().add(attempt(reg, "RELEASED"));
        assertThatThrownBy(() -> guard.requireNoFinalizedAttemptForApiExam(reg)).isInstanceOf(ResultLockedException.class);
    }
}
