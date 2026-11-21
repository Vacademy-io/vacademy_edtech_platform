package vacademy.io.admin_core_service.core.security;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * A user who holds only commerce roles is shop staff, not general staff: the general staff
 * checks refuse an account whose only roles are commerce roles.
 */
class InstituteAccessValidatorCommerceStaffTest {

    private static final String INSTITUTE = "inst-1";

    private final InstituteAccessValidator validator = new InstituteAccessValidator();

    @BeforeEach
    void clientIdHeaderMatchesInstitute() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INSTITUTE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails principal(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setRootUser(false);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    @Test
    void commerceOnlyUserIsNotGeneralStaff() {
        for (String role : new String[]{"COMMERCE_STORE_MANAGER", "COMMERCE_WAREHOUSE_STAFF",
                "COMMERCE_POS_CASHIER", "COMMERCE_ACCOUNTANT"}) {
            assertThrows(ForbiddenException.class,
                    () -> validator.requireStaffAccess(principal(role), INSTITUTE), role);
            assertThrows(ForbiddenException.class,
                    () -> validator.requireInstituteStaff(principal(role), INSTITUTE), role);
        }
        assertThrows(ForbiddenException.class, () -> validator.requireInstituteStaff(
                principal("COMMERCE_POS_CASHIER", "commerce_warehouse_staff"), INSTITUTE));
    }

    @Test
    void staffWhoAlsoHoldACommerceRoleStayStaff() {
        assertDoesNotThrow(() -> validator.requireInstituteStaff(
                principal("TEACHER", "COMMERCE_POS_CASHIER"), INSTITUTE));
        assertDoesNotThrow(() -> validator.requireInstituteStaff(
                principal("ADMIN", "COMMERCE_STORE_MANAGER"), INSTITUTE));
        // A custom institute role beside the commerce role: staff as before.
        assertDoesNotThrow(() -> validator.requireStaffAccess(
                principal("COUNSELLOR", "COMMERCE_ACCOUNTANT"), INSTITUTE));
    }

    @Test
    void learnerWithACommerceRoleIsStillRefused() {
        assertThrows(ForbiddenException.class, () -> validator.requireInstituteStaff(
                principal("STUDENT", "COMMERCE_POS_CASHIER"), INSTITUTE));
    }

    @Test
    void theRootFlagDoesNotMakeAShopOnlyAccountGeneralStaff() {
        // The root flag does not turn a commerce-only account into general staff.
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-2");
        dto.setUsername("u-2");
        dto.setFullName("Cashier");
        dto.setRootUser(true);
        dto.setAuthorities(List.of("COMMERCE_POS_CASHIER"));
        CustomUserDetails rootCashier = new CustomUserDetails(dto);
        assertThrows(ForbiddenException.class, () -> validator.requireStaffAccess(rootCashier, INSTITUTE));

        // Without commerce-only roles, the root flag behaves exactly as it did before.
        dto.setAuthorities(List.of());
        assertDoesNotThrow(() -> validator.requireStaffAccess(new CustomUserDetails(dto), INSTITUTE));
        // A staff role beside the commerce role still passes.
        dto.setAuthorities(List.of("TEACHER", "COMMERCE_POS_CASHIER"));
        assertDoesNotThrow(() -> validator.requireStaffAccess(new CustomUserDetails(dto), INSTITUTE));
    }
}
