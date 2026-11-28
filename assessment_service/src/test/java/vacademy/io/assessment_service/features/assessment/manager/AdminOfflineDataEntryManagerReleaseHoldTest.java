package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A copy uploaded for a student (single offline entry, or one copy of a bulk AI
 * intake — both create the attempt here) must start with its report HELD.
 *
 * A NULL release status is a dead zone: the learner's Reports list filters on
 * RELEASED/PENDING, so the copy vanished for the student even after the AI had
 * graded it, and the admin's Result Status column read "Not available". PENDING
 * is what every other submission path writes, and what "Release Result" flips.
 */
class AdminOfflineDataEntryManagerReleaseHoldTest {

    @Test
    void anUploadedCopyStartsWithItsReportHeldUntilSomeoneReleasesIt() {
        Assessment assessment = new Assessment();
        assessment.setId("asmt-1");
        assessment.setDuration(60);
        AssessmentUserRegistration registration = new AssessmentUserRegistration();
        registration.setId("reg-1");
        registration.setAssessment(assessment);

        AssessmentUserRegistrationRepository registrations = mock(AssessmentUserRegistrationRepository.class);
        when(registrations.findById("reg-1")).thenReturn(Optional.of(registration));
        StudentAttemptService attempts = mock(StudentAttemptService.class);
        when(attempts.updateStudentAttempt(any())).thenAnswer(inv -> inv.getArgument(0));

        AdminOfflineDataEntryManager manager = new AdminOfflineDataEntryManager();
        ReflectionTestUtils.setField(manager, "assessmentUserRegistrationRepository", registrations);
        ReflectionTestUtils.setField(manager, "studentAttemptService", attempts);

        manager.createOfflineAttempt(mock(CustomUserDetails.class), "asmt-1", "reg-1", "inst-1", null);

        ArgumentCaptor<StudentAttempt> saved = ArgumentCaptor.forClass(StudentAttempt.class);
        verify(attempts).updateStudentAttempt(saved.capture());
        assertThat(saved.getValue().getStatus()).isEqualTo("ENDED");
        assertThat(saved.getValue().getResultStatus()).isEqualTo("PENDING");
        assertThat(saved.getValue().getReportReleaseStatus())
                .as("report must be held until Release Result, not left NULL (invisible to both sides)")
                .isEqualTo("PENDING");
    }
}
