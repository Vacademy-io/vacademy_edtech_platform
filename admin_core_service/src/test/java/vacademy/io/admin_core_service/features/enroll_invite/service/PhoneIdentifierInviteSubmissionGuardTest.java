package vacademy.io.admin_core_service.features.enroll_invite.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.common.exceptions.EnrollmentConflictException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The guard blocks only a CURRENT member of the invite's course (an ACTIVE mapping
 * from a completed enrolment) — abandoned carts, failed payments and expired plans
 * may register again (0764131992). Rewritten for that rule: the previous version
 * still mocked the UserPlanRepository the guard no longer uses, and stopped
 * compiling, which blocked every admin_core deploy.
 */
@ExtendWith(MockitoExtension.class)
class PhoneIdentifierInviteSubmissionGuardTest {

    @Mock
    private InstituteSettingService instituteSettingService;

    @Mock
    private StudentSessionInstituteGroupMappingRepository mappingRepository;

    @Mock
    private PackageSessionLearnerInvitationToPaymentOptionRepository inviteMappingRepository;

    private PhoneIdentifierInviteSubmissionGuard service() {
        return new PhoneIdentifierInviteSubmissionGuard(
                instituteSettingService, mappingRepository, inviteMappingRepository);
    }

    @Test
    void anActiveMemberOfTheCourseIsRejected() {
        phoneInstitute();
        inviteCovers("ps-1");
        when(mappingRepository.existsActiveMembership("user-1", List.of("ps-1"))).thenReturn(true);

        EnrollmentConflictException error = assertThrows(
                EnrollmentConflictException.class,
                () -> service().validateNotAlreadySubmitted(invite(), "user-1", "inst-1"));

        assertEquals(EnrollmentConflictException.ConflictType.ALREADY_ENROLLED,
                error.getConflictType());
    }

    @Test
    void someoneWhoIsNotAMemberMayRegister() {
        // Abandoned cart, failed payment, expired plan: no ACTIVE membership.
        phoneInstitute();
        inviteCovers("ps-1");
        when(mappingRepository.existsActiveMembership("user-1", List.of("ps-1"))).thenReturn(false);

        assertDoesNotThrow(() -> service().validateNotAlreadySubmitted(invite(), "user-1", "inst-1"));
    }

    @Test
    void anInviteWithNoActiveCourseBlocksNobody() {
        phoneInstitute();
        when(inviteMappingRepository.findByEnrollInviteIdAndStatusWithPackageSession("invite-1", List.of("ACTIVE")))
                .thenReturn(List.of());

        assertDoesNotThrow(() -> service().validateNotAlreadySubmitted(invite(), "user-1", "inst-1"));
        verifyNoInteractions(mappingRepository);
    }

    @Test
    void emailIdentifierInstitutesKeepExistingBehavior() {
        when(instituteSettingService.getSettingByInstituteIdAndKey("inst-1", "USER_IDENTIFIER"))
                .thenReturn("EMAIL");

        assertDoesNotThrow(() -> service().validateNotAlreadySubmitted(invite(), "user-1", "inst-1"));
        verifyNoInteractions(mappingRepository, inviteMappingRepository);
    }

    private void phoneInstitute() {
        when(instituteSettingService.getSettingByInstituteIdAndKey("inst-1", "USER_IDENTIFIER"))
                .thenReturn("PHONE");
    }

    private void inviteCovers(String packageSessionId) {
        PackageSession ps = new PackageSession();
        ps.setId(packageSessionId);
        PackageSessionLearnerInvitationToPaymentOption link = new PackageSessionLearnerInvitationToPaymentOption();
        link.setPackageSession(ps);
        when(inviteMappingRepository.findByEnrollInviteIdAndStatusWithPackageSession("invite-1", List.of("ACTIVE")))
                .thenReturn(List.of(link));
    }

    private EnrollInvite invite() {
        EnrollInvite invite = new EnrollInvite();
        invite.setId("invite-1");
        return invite;
    }
}
