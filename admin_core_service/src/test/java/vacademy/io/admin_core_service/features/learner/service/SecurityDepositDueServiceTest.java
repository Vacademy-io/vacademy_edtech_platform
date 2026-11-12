package vacademy.io.admin_core_service.features.learner.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enroll_invite.service.PhoneIdentifierInviteSubmissionGuard;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.learner.service.SecurityDepositDueService.Person;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The once-per-user deposit rule: due unless the person ever had a paid / granted plan on a
 * SECURITY_DEPOSIT or MEMBERSHIP package of the institute. The SQL itself needs a database; these
 * pin what is asked of it and how the person is resolved without creating anyone.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SecurityDepositDueServiceTest {

    private static final String INSTITUTE = "inst-1";

    @Mock private UserPlanRepository userPlanRepository;
    @Mock private InstituteStudentRepository instituteStudentRepository;
    @Mock private PhoneIdentifierInviteSubmissionGuard phoneIdentifierGuard;
    @Mock private AuthService authService;
    @InjectMocks private SecurityDepositDueService service;

    private void priorPlan(boolean exists) {
        when(userPlanRepository.existsGrantedPlanOnPackageTypes(anyString(), anyString(), anyString(),
                anyList(), anyList(), anyList())).thenReturn(exists);
    }

    private static UserDTO buyer(String id, String mobile, String email) {
        UserDTO user = new UserDTO();
        user.setId(id);
        user.setMobileNumber(mobile);
        user.setEmail(email);
        return user;
    }

    @Test
    void aPriorDepositOrMembershipMeansNotDue() {
        priorPlan(true);

        assertFalse(service.isDue(new Person("u-1", ""), INSTITUTE));
        verify(userPlanRepository).existsGrantedPlanOnPackageTypes(eq("u-1"), eq(""), eq(INSTITUTE),
                eq(List.of("SECURITY_DEPOSIT", "MEMBERSHIP")), anyList(), anyList());
    }

    @Test
    void noPriorDepositOrMembershipMeansDue() {
        priorPlan(false);

        assertTrue(service.isDue(new Person("u-1", ""), INSTITUTE));
    }

    @Test
    void onlyPaidOrGrantedPlansCountNotOnesWaitingForPaymentOrFailed() {
        // A learner whose only membership is PENDING_FOR_PAYMENT (abandoned checkout) has never
        // paid the deposit: the query is asked about granted statuses and PAID logs only.
        assertTrue(SecurityDepositDueService.GRANTED_STATUSES.containsAll(List.of(
                UserPlanStatusEnum.ACTIVE.name(), UserPlanStatusEnum.PENDING.name(), UserPlanStatusEnum.EXPIRED.name())));
        assertFalse(SecurityDepositDueService.GRANTED_STATUSES.contains(UserPlanStatusEnum.PENDING_FOR_PAYMENT.name()));
        assertFalse(SecurityDepositDueService.GRANTED_STATUSES.contains(UserPlanStatusEnum.PAYMENT_FAILED.name()));
        // CANCELED / TERMINATED count only through a PAID payment log (refunded after paying).
        assertFalse(SecurityDepositDueService.GRANTED_STATUSES.contains(UserPlanStatusEnum.CANCELED.name()));
        assertFalse(SecurityDepositDueService.GRANTED_STATUSES.contains(UserPlanStatusEnum.TERMINATED.name()));
        assertEquals(List.of("PAID"), SecurityDepositDueService.PAID_STATUSES);

        priorPlan(false); // the pending plan matches neither
        assertTrue(service.isDue(new Person("u-1", ""), INSTITUTE));
        verify(userPlanRepository).existsGrantedPlanOnPackageTypes(eq("u-1"), eq(""), eq(INSTITUTE), anyList(),
                eq(SecurityDepositDueService.GRANTED_STATUSES), eq(SecurityDepositDueService.PAID_STATUSES));
    }

    @Test
    void nobodyIsDueWithoutAsking() {
        assertTrue(service.isDue(service.buyer(null, INSTITUTE), INSTITUTE));
        assertTrue(service.isDue(service.buyer(buyer(null, null, null), INSTITUTE), INSTITUTE));
        verify(userPlanRepository, never()).existsGrantedPlanOnPackageTypes(any(), any(), any(), any(), any(), any());
    }

    @Test
    void aGuestUnknownByEmailIsDue() {
        when(authService.findUserByEmailStrict("new@example.com")).thenReturn(Optional.empty());

        assertTrue(service.isDue(service.buyer(buyer(null, null, "new@example.com"), INSTITUTE), INSTITUTE));
        verify(userPlanRepository, never()).existsGrantedPlanOnPackageTypes(any(), any(), any(), any(), any(), any());
    }

    @Test
    void aPhoneIdentifiedGuestIsMatchedByTheLastTenDigitsWithoutAuthCalls() {
        when(phoneIdentifierGuard.usesPhoneIdentifier(INSTITUTE)).thenReturn(true);

        Person person = service.buyer(buyer(null, "+91 98765-43210", "x@example.com"), INSTITUTE);

        assertEquals(new Person("", "9876543210"), person);
        verify(authService, never()).findUserByEmailStrict(anyString());
    }

    @Test
    void aGuestIsLookedUpByEmailWhereLearnersAreNotIdentifiedByPhone() {
        when(phoneIdentifierGuard.usesPhoneIdentifier(INSTITUTE)).thenReturn(false);
        UserDTO existing = buyer("u-7", null, "member@example.com");
        when(authService.findUserByEmailStrict("member@example.com")).thenReturn(Optional.of(existing));

        assertEquals(new Person("u-7", ""), service.buyer(buyer(null, "9876543210", "member@example.com"), INSTITUTE));
    }

    @Test
    void aBuyerWithAnIdKeepsItAndAddsThePhoneWhereThatIsTheIdentity() {
        when(phoneIdentifierGuard.usesPhoneIdentifier(INSTITUTE)).thenReturn(true);

        assertEquals(new Person("u-1", "9876543210"), service.buyer(buyer("u-1", "9876543210", null), INSTITUTE));
        verify(authService, never()).findUserByEmailStrict(anyString());
    }

    @Test
    void aSignedInLearnerIsAskedAboutTogetherWithTheirOwnPhone() {
        when(phoneIdentifierGuard.usesPhoneIdentifier(INSTITUTE)).thenReturn(true);
        Student student = new Student();
        student.setMobileNumber("919876543210");
        when(instituteStudentRepository.findTopByUserIdOrderByCreatedAtDesc("u-1")).thenReturn(Optional.of(student));

        assertEquals(new Person("u-1", "9876543210"), service.signedInUser("u-1", INSTITUTE));
    }

    @Test
    void aShortNumberMatchesNobody() {
        assertEquals("", SecurityDepositDueService.lastTenDigits("12345"));
        assertEquals("", SecurityDepositDueService.lastTenDigits(null));
    }
}
