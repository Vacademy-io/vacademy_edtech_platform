package vacademy.io.assessment_service.features.open_registration.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.notification.service.LearnerAssessmentNoticeService;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The "You're registered" email waits for OTP verification and goes out once. */
class AssessmentRegistrationConfirmationTest {

    private AssessmentUserRegistrationRepository registrations;
    private LearnerAssessmentNoticeService notices;
    private AssessmentPublicPageManager manager;

    @BeforeEach
    void setUp() {
        registrations = mock(AssessmentUserRegistrationRepository.class);
        notices = mock(LearnerAssessmentNoticeService.class);
        manager = new AssessmentPublicPageManager();
        manager.assessmentUserRegistrationRepository = registrations;
        manager.learnerAssessmentNoticeService = notices;
    }

    private static AssessmentUserRegistration registration(String status, String source) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setId("reg-1");
        r.setStatus(status);
        r.setSource(source);
        return r;
    }

    @Test
    void sendsOnceTheLearnerHasVerified() {
        when(registrations.findTopByUserIdAndAssessmentId("u1", "as-1"))
                .thenReturn(Optional.of(registration("ACTIVE", "OPEN_REGISTRATION")));
        when(registrations.claimConfirmationEmail("reg-1")).thenReturn(1);

        assertThat(manager.confirmVerifiedRegistration("u1", "as-1").getBody()).isEqualTo("Confirmation sent");
        verify(notices).sendRegistrationConfirmation("as-1", "reg-1");
    }

    @Test
    void secondVerificationDoesNotSendAgain() {
        when(registrations.findTopByUserIdAndAssessmentId("u1", "as-1"))
                .thenReturn(Optional.of(registration("ACTIVE", "OPEN_REGISTRATION")));
        when(registrations.claimConfirmationEmail("reg-1")).thenReturn(0);

        assertThat(manager.confirmVerifiedRegistration("u1", "as-1").getBody()).isEqualTo("Already confirmed");
        verify(notices, never()).sendRegistrationConfirmation(anyString(), anyString());
    }

    @Test
    void learnersTheAdminAddedAreNotConfirmedHere() {
        when(registrations.findTopByUserIdAndAssessmentId("u1", "as-1"))
                .thenReturn(Optional.of(registration("ACTIVE", "ADMIN_PRE_REGISTRATION")));

        manager.confirmVerifiedRegistration("u1", "as-1");

        verify(registrations, never()).claimConfirmationEmail(anyString());
        verify(notices, never()).sendRegistrationConfirmation(anyString(), anyString());
    }

    @Test
    void removedOrMissingRegistrationGetsNothing() {
        when(registrations.findTopByUserIdAndAssessmentId("u1", "as-1"))
                .thenReturn(Optional.of(registration("DELETED", "OPEN_REGISTRATION")));
        manager.confirmVerifiedRegistration("u1", "as-1");
        when(registrations.findTopByUserIdAndAssessmentId("u2", "as-1")).thenReturn(Optional.empty());
        manager.confirmVerifiedRegistration("u2", "as-1");

        verify(notices, never()).sendRegistrationConfirmation(anyString(), anyString());
    }
}
