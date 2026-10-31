package vacademy.io.admin_core_service.features.fee_management.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.GuardedChild;
import vacademy.io.admin_core_service.core.security.GuardianAccessGuard;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.ComplexPaymentOptionRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * /v1/admin/student-fee had no caller check on any route: any signed-in user could read any
 * institute's fee roster, mark bills paid or grant concessions. These pin who may do what. The
 * real {@link InstituteAccessValidator} runs with the clientId header set; the guardian link
 * (auth_service) is mocked.
 */
class FeeAccessGuardTest {

    private static final String INSTITUTE = "inst-1";
    private static final String OTHER_INSTITUTE = "inst-2";
    private static final String CHILD = "child-1";

    private final GuardianAccessGuard guardianAccessGuard = mock(GuardianAccessGuard.class);
    private final ComplexPaymentOptionRepository cpoRepository = mock(ComplexPaymentOptionRepository.class);
    private final FeeAccessGuard guard = new FeeAccessGuard(new InstituteAccessValidator(), guardianAccessGuard, cpoRepository);

    @BeforeEach
    void clientIdHeaderMatchesInstitute() {
        clientIdHeader(INSTITUTE);
    }

    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientIdHeader(String clientId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (clientId != null) {
            request.addHeader("clientId", clientId);
        }
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    /** Root flag set on every principal: learners and invited staff are root users too. */
    private static CustomUserDetails principal(String userId, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName("Test User");
        dto.setRootUser(true);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static CustomUserDetails admin() {
        return principal("admin", "ADMIN");
    }

    private static CustomUserDetails teacher() {
        return principal("teacher", "TEACHER");
    }

    private static CustomUserDetails customRole() {
        return principal("accountant", "ACCOUNTANT", "SOME_PERMISSION");
    }

    private static CustomUserDetails learner() {
        return principal(CHILD, "STUDENT");
    }

    private static CustomUserDetails parent() {
        return principal("parent-1", "PARENT");
    }

    private static StudentFeePayment bill(String instituteId, String cpoId) {
        StudentFeePayment bill = new StudentFeePayment();
        bill.setId("bill-" + instituteId + "-" + cpoId);
        bill.setUserId(CHILD);
        bill.setInstituteId(instituteId);
        bill.setCpoId(cpoId);
        return bill;
    }

    private void cpoOf(String cpoId, String instituteId) {
        ComplexPaymentOption cpo = new ComplexPaymentOption();
        cpo.setId(cpoId);
        cpo.setInstituteId(instituteId);
        when(cpoRepository.findById(cpoId)).thenReturn(Optional.of(cpo));
    }

    // ---- staff-only routes -------------------------------------------------------------

    @Test
    @DisplayName("admin, teacher and custom staff roles of the clientId institute pass")
    void staffPass() {
        assertDoesNotThrow(() -> guard.requireStaff(admin(), INSTITUTE));
        assertDoesNotThrow(() -> guard.requireStaff(teacher(), INSTITUTE));
        assertDoesNotThrow(() -> guard.requireStaff(customRole(), INSTITUTE));
    }

    @Test
    @DisplayName("learners and parents are refused even though they are root users")
    void learnersRefused() {
        assertThrows(ForbiddenException.class, () -> guard.requireStaff(learner(), INSTITUTE));
        assertThrows(ForbiddenException.class, () -> guard.requireStaff(parent(), INSTITUTE));
        assertThrows(ForbiddenException.class,
                () -> guard.requireStaff(principal("dual", "STUDENT", "TEACHER"), INSTITUTE));
    }

    @Test
    @DisplayName("staff of another institute (clientId != instituteId) is refused")
    void crossTenantRefused() {
        assertThrows(ForbiddenException.class, () -> guard.requireStaff(admin(), OTHER_INSTITUTE));
        clientIdHeader(null);
        assertThrows(ForbiddenException.class, () -> guard.requireStaff(admin(), INSTITUTE));
    }

    // ---- bill ownership ----------------------------------------------------------------

    @Test
    @DisplayName("bills must belong to the institute the caller is staff of")
    void billsOfAnotherInstituteRefused() {
        assertDoesNotThrow(() -> guard.requireStaffForBills(admin(), INSTITUTE, List.of(bill(INSTITUTE, "cpo-1"))));
        assertThrows(ForbiddenException.class, () -> guard.requireStaffForBills(admin(), INSTITUTE,
                List.of(bill(INSTITUTE, "cpo-1"), bill(OTHER_INSTITUTE, "cpo-2"))));
    }

    @Test
    @DisplayName("a pre-V163 bill with no institute_id resolves through its payment option")
    void legacyBillResolvesViaPaymentOption() {
        cpoOf("cpo-legacy", INSTITUTE);
        cpoOf("cpo-foreign", OTHER_INSTITUTE);
        assertDoesNotThrow(() -> guard.requireStaffForBills(admin(), INSTITUTE, List.of(bill(null, "cpo-legacy"))));
        assertThrows(ForbiddenException.class,
                () -> guard.requireStaffForBills(admin(), INSTITUTE, List.of(bill(null, "cpo-foreign"))));
    }

    @Test
    @DisplayName("user-wide allocation: all unpaid bills must resolve to the caller's one institute")
    void allocationInstituteResolution() {
        assertEquals(INSTITUTE, guard.requireStaffOfBillsInstitute(admin(), List.of(bill(INSTITUTE, "c")), null));
        assertEquals(INSTITUTE, guard.requireStaffOfBillsInstitute(admin(), List.of(bill(INSTITUTE, "c")), INSTITUTE));
        // naming your own institute does not let you settle another institute's bills
        assertThrows(ForbiddenException.class,
                () -> guard.requireStaffOfBillsInstitute(admin(), List.of(bill(OTHER_INSTITUTE, "c")), INSTITUTE));
        assertThrows(ForbiddenException.class, () -> guard.requireStaffOfBillsInstitute(admin(),
                List.of(bill(INSTITUTE, "c"), bill(OTHER_INSTITUTE, "d")), null));
        // nothing to resolve from: named institute decides
        assertEquals(INSTITUTE, guard.requireStaffOfBillsInstitute(admin(), List.of(), INSTITUTE));
        assertThrows(ForbiddenException.class, () -> guard.requireStaffOfBillsInstitute(admin(), List.of(), null));
        assertThrows(ForbiddenException.class,
                () -> guard.requireStaffOfBillsInstitute(learner(), List.of(bill(INSTITUTE, "c")), null));
    }

    @Test
    @DisplayName("payment details: staff of the payment option's institute")
    void paymentOptionInstitute() {
        cpoOf("cpo-1", INSTITUTE);
        cpoOf("cpo-2", OTHER_INSTITUTE);
        assertDoesNotThrow(() -> guard.requireStaffOfPaymentOption(teacher(), "cpo-1"));
        assertThrows(ForbiddenException.class, () -> guard.requireStaffOfPaymentOption(admin(), "cpo-2"));
        assertThrows(ForbiddenException.class, () -> guard.requireStaffOfPaymentOption(admin(), "missing"));
        assertThrows(ForbiddenException.class, () -> guard.requireStaffOfPaymentOption(learner(), "cpo-1"));
    }

    // ---- parent-portal reads -----------------------------------------------------------

    @Test
    @DisplayName("parent portal: staff pass without the guardian check")
    void learnerSideStaffShortCircuits() {
        guard.requireStaffOrLearnerSide(admin(), CHILD, INSTITUTE);
        verify(guardianAccessGuard, never()).requireLinkedChild(any(), any());
    }

    @Test
    @DisplayName("parent portal: a linked guardian or the learner, for the clientId institute only")
    void learnerSideLinkedGuardian() {
        CustomUserDetails parent = parent();
        when(guardianAccessGuard.requireLinkedChild(parent, CHILD))
                .thenReturn(new GuardedChild(CHILD, INSTITUTE, List.of("ps-1"), "Child"));
        assertDoesNotThrow(() -> guard.requireStaffOrLearnerSide(parent, CHILD, INSTITUTE));
        // the guardian check ran against the clientId institute; another institute's fees stay closed
        assertThrows(ForbiddenException.class, () -> guard.requireStaffOrLearnerSide(parent, CHILD, OTHER_INSTITUTE));
        assertThrows(Exception.class, () -> guard.requireStaffOrLearnerSide(parent, CHILD, null));
    }

    @Test
    @DisplayName("parent portal: an unlinked parent or another learner is refused")
    void learnerSideUnlinkedRefused() {
        CustomUserDetails parent = parent();
        when(guardianAccessGuard.requireLinkedChild(parent, "stranger"))
                .thenThrow(new ForbiddenException("Child is not linked to this guardian"));
        assertThrows(ForbiddenException.class, () -> guard.requireStaffOrLearnerSide(parent, "stranger", INSTITUTE));
    }
}
