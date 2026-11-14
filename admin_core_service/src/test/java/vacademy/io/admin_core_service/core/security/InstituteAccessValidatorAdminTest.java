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

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link InstituteAccessValidator#requireInstituteAdmin} guards the AI-calling API key
 * admin endpoints ({@code requireInstituteStaff} the AI call / campaign / queue endpoints). They used {@code validateUserAccess}, which returns early for any root
 * user -- and learners are created as root users, so any learner could mint a calling key
 * that spends any institute's credits. These tests pin: ADMIN of that institute only, and
 * the root flag grants nothing.
 */
class InstituteAccessValidatorAdminTest {

    private static final String INSTITUTE = "inst-1";

    private final InstituteAccessValidator validator = new InstituteAccessValidator();

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

    private static CustomUserDetails principal(boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    @Test
    @DisplayName("institute ADMIN (root flag set, as every dashboard admin is) is allowed")
    void rootAdminAllowed() {
        assertDoesNotThrow(() -> validator.requireInstituteAdmin(principal(true, "ADMIN"), INSTITUTE));
    }

    @Test
    @DisplayName("non-root ADMIN is allowed (case-insensitive)")
    void adminAllowed() {
        assertDoesNotThrow(() -> validator.requireInstituteAdmin(principal(false, "admin"), INSTITUTE));
    }

    @Test
    @DisplayName("learner with the root flag is denied (the S0 hole)")
    void rootLearnerDenied() {
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteAdmin(principal(true, "STUDENT"), INSTITUTE));
    }

    @Test
    @DisplayName("root user with no clientId header and no authorities is denied")
    void rootWithoutMembershipDenied() {
        clientIdHeader(null);
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteAdmin(principal(true), INSTITUTE));
    }

    @Test
    @DisplayName("TEACHER of the institute is denied")
    void teacherDenied() {
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteAdmin(principal(false, "TEACHER"), INSTITUTE));
    }

    @Test
    @DisplayName("ADMIN of ANOTHER institute (clientId mismatch) is denied, root or not")
    void crossTenantAdminDenied() {
        clientIdHeader("inst-other");
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteAdmin(principal(false, "ADMIN"), INSTITUTE));
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteAdmin(principal(true, "ADMIN"), INSTITUTE));
    }

    @Test
    @DisplayName("ADMIN without a clientId header is denied")
    void adminWithoutClientIdDenied() {
        clientIdHeader(null);
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteAdmin(principal(false, "ADMIN"), INSTITUTE));
    }

    @Test
    @DisplayName("null user and blank institute are refused")
    void nullInputsRefused() {
        assertThrows(RuntimeException.class, () -> validator.requireInstituteAdmin(null, INSTITUTE));
        assertThrows(RuntimeException.class,
                () -> validator.requireInstituteAdmin(principal(false, "ADMIN"), " "));
    }

    // requireInstituteStaff: AI call connect / campaign / queue (spends calling credits).

    @Test
    @DisplayName("staff: ADMIN, TEACHER and a custom role are allowed, root flag or not")
    void staffAllowed() {
        assertDoesNotThrow(() -> validator.requireInstituteStaff(principal(true, "ADMIN"), INSTITUTE));
        assertDoesNotThrow(() -> validator.requireInstituteStaff(principal(false, "TEACHER"), INSTITUTE));
        assertDoesNotThrow(() -> validator.requireInstituteStaff(principal(true, "COUNSELLOR"), INSTITUTE));
    }

    @Test
    @DisplayName("staff: root learner is denied, also with TEACHER from self-signup")
    void staffRootLearnerDenied() {
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteStaff(principal(true, "STUDENT"), INSTITUTE));
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteStaff(principal(true, "STUDENT", "TEACHER"), INSTITUTE));
    }

    @Test
    @DisplayName("staff: root user of another institute or with no clientId is denied")
    void staffCrossTenantDenied() {
        clientIdHeader("inst-other");
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteStaff(principal(true, "ADMIN"), INSTITUTE));
        clientIdHeader(null);
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteStaff(principal(true), INSTITUTE));
    }

    @Test
    @DisplayName("requireStaffAccess keeps its root shortcut (existing callers unchanged)")
    void requireStaffAccessUnchanged() {
        clientIdHeader(null);
        assertDoesNotThrow(() -> validator.requireStaffAccess(principal(true), INSTITUTE));
    }

    @Test
    @DisplayName("isInstituteAdmin keeps its root shortcut (degrade-only callers unchanged)")
    void isInstituteAdminUnchanged() {
        assertTrue(validator.isInstituteAdmin(principal(true)));
        assertTrue(validator.isInstituteAdmin(principal(false, "ADMIN")));
    }
}
