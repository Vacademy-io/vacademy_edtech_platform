package vacademy.io.admin_core_service.core.security;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * The "...OrSuperAdmin" guards used by payment gateway settings, invoices, payment logs and
 * HR: the caller is staff (or admin) of the institute named by the clientId header, or a
 * platform super admin on the SUPER_ADMIN_USER_IDS allowlist. The root flag grants nothing.
 */
class InstituteAccessValidatorSuperAdminTest {

    private static final String INSTITUTE = "inst-1";
    private static final String SUPER_ADMIN_ID = "ops-1";

    /** Stands in for the env allowlist, which a unit test cannot set. */
    private final InstituteAccessValidator validator = new InstituteAccessValidator() {
        @Override
        public boolean isPlatformSuperAdmin(CustomUserDetails user) {
            return user != null && Set.of(SUPER_ADMIN_ID).contains(user.getUserId());
        }
    };

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

    private static CustomUserDetails principal(String userId, boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName("Test User");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    @Test
    @DisplayName("admin guard: ADMIN of the institute passes, root flag or not")
    void adminOfInstituteAllowed() {
        assertDoesNotThrow(() -> validator.requireInstituteAdminOrSuperAdmin(principal("u-1", true, "ADMIN"), INSTITUTE));
        assertDoesNotThrow(() -> validator.requireInstituteAdminOrSuperAdmin(principal("u-1", false, "ADMIN"), INSTITUTE));
    }

    @Test
    @DisplayName("admin guard: TEACHER of the institute is refused")
    void teacherRefusedForAdminGuard() {
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteAdminOrSuperAdmin(principal("u-1", false, "TEACHER"), INSTITUTE));
    }

    @Test
    @DisplayName("staff guard: ADMIN, TEACHER and a custom role of the institute pass")
    void staffOfInstituteAllowed() {
        assertDoesNotThrow(() -> validator.requireInstituteStaffOrSuperAdmin(principal("u-1", true, "ADMIN"), INSTITUTE));
        assertDoesNotThrow(() -> validator.requireInstituteStaffOrSuperAdmin(principal("u-1", false, "TEACHER"), INSTITUTE));
        assertDoesNotThrow(() -> validator.requireInstituteStaffOrSuperAdmin(principal("u-1", false, "ACCOUNTS"), INSTITUTE));
    }

    @Test
    @DisplayName("allowlisted super admin passes every guard without a role or clientId")
    void superAdminAllowed() {
        clientIdHeader(null);
        CustomUserDetails ops = principal(SUPER_ADMIN_ID, false);
        assertDoesNotThrow(() -> validator.requireInstituteAdminOrSuperAdmin(ops, INSTITUTE));
        assertDoesNotThrow(() -> validator.requireInstituteStaffOrSuperAdmin(ops, INSTITUTE));
        assertDoesNotThrow(() -> validator.requireInstituteMemberOrSuperAdmin(ops, INSTITUTE));
    }

    @Test
    @DisplayName("root-flag account of another institute is refused by every guard")
    void rootUserOfOtherInstituteRefused() {
        clientIdHeader("inst-other");
        CustomUserDetails otherAdmin = principal("u-2", true, "ADMIN");
        assertThrows(ForbiddenException.class, () -> validator.requireInstituteAdminOrSuperAdmin(otherAdmin, INSTITUTE));
        assertThrows(ForbiddenException.class, () -> validator.requireInstituteStaffOrSuperAdmin(otherAdmin, INSTITUTE));
        assertThrows(ForbiddenException.class, () -> validator.requireInstituteMemberOrSuperAdmin(otherAdmin, INSTITUTE));
    }

    @Test
    @DisplayName("root-flag account with no clientId and no roles is refused")
    void rootUserWithoutMembershipRefused() {
        clientIdHeader(null);
        CustomUserDetails root = principal("u-3", true);
        assertThrows(ForbiddenException.class, () -> validator.requireInstituteAdminOrSuperAdmin(root, INSTITUTE));
        assertThrows(ForbiddenException.class, () -> validator.requireInstituteStaffOrSuperAdmin(root, INSTITUTE));
        assertThrows(ForbiddenException.class, () -> validator.requireInstituteMemberOrSuperAdmin(root, INSTITUTE));
    }

    @Test
    @DisplayName("staff guard: learner of the institute with the root flag is refused; member guard lets it in")
    void rootLearnerOnlyMember() {
        CustomUserDetails learner = principal("u-4", true, "STUDENT");
        assertThrows(ForbiddenException.class, () -> validator.requireInstituteStaffOrSuperAdmin(learner, INSTITUTE));
        assertDoesNotThrow(() -> validator.requireInstituteMemberOrSuperAdmin(learner, INSTITUTE));
    }

    @Test
    @DisplayName("blank institute is refused even for a super admin")
    void blankInstituteRefused() {
        assertThrows(RuntimeException.class,
                () -> validator.requireInstituteStaffOrSuperAdmin(principal(SUPER_ADMIN_ID, false), " "));
    }

    @Test
    @DisplayName("without SUPER_ADMIN_USER_IDS set nobody is a platform super admin, root flag or not")
    void realAllowlistUnsetMeansNobody() {
        InstituteAccessValidator real = new InstituteAccessValidator();
        assertFalse(real.isPlatformSuperAdmin(principal("u-1", true, "ADMIN")));
        assertFalse(real.isPlatformSuperAdmin(null));
    }
}
