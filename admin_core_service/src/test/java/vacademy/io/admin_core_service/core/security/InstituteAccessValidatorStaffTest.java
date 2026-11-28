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
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link InstituteAccessValidator#requireStaffAccess} guards the learner-badge staff
 * endpoints, which used to be open to any authenticated principal — a STUDENT could award
 * or revoke badges for anyone in any institute.
 *
 * <p>The principal's authorities list in this service mixes role names with permission
 * names, so the guard cannot simply test "has any authority": a learner whose STUDENT role
 * is one day granted a permission would pass. These tests pin the intended three-way rule
 * (known staff role → allow; learner role → deny even with extra names; other non-empty →
 * allow as a custom staff role; root → always allow).
 */
class InstituteAccessValidatorStaffTest {

    private static final String INSTITUTE = "inst-1";

    private final InstituteAccessValidator validator = new InstituteAccessValidator();

    @BeforeEach
    void clientIdHeaderMatchesInstitute() {
        // Non-root membership is proven by a non-empty authorities list plus a clientId
        // header equal to the path instituteId (see validateUserAccess).
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INSTITUTE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
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
    @DisplayName("STUDENT is denied with a ForbiddenException")
    void studentDenied() {
        assertThrows(ForbiddenException.class,
                () -> validator.requireStaffAccess(principal(false, "STUDENT"), INSTITUTE));
    }

    @Test
    @DisplayName("STUDENT carrying a stray permission name is still denied")
    void studentWithPermissionDenied() {
        assertThrows(ForbiddenException.class,
                () -> validator.requireStaffAccess(principal(false, "STUDENT", "VIEW_CALL_NUMBERS"), INSTITUTE));
    }

    @Test
    @DisplayName("PARENT is denied")
    void parentDenied() {
        assertThrows(ForbiddenException.class,
                () -> validator.requireStaffAccess(principal(false, "PARENT"), INSTITUTE));
    }

    @Test
    @DisplayName("STUDENT + TEACHER (self-signup with allowLearnersToCreateCourses) is still a learner -> denied")
    void studentWithTeacherDenied() {
        assertThrows(ForbiddenException.class,
                () -> validator.requireStaffAccess(principal(false, "STUDENT", "TEACHER"), INSTITUTE));
    }

    @Test
    @DisplayName("an ADMIN who is also enrolled as a STUDENT keeps staff access")
    void adminEnrolledAsStudentAllowed() {
        assertDoesNotThrow(() -> validator.requireStaffAccess(principal(false, "STUDENT", "ADMIN"), INSTITUTE));
    }

    @Test
    @DisplayName("a COUNSELLOR who is also enrolled as a STUDENT keeps staff access")
    void counsellorEnrolledAsStudentAllowed() {
        assertDoesNotThrow(() -> validator.requireStaffAccess(principal(false, "STUDENT", "COUNSELLOR"), INSTITUTE));
    }

    @Test
    @DisplayName("requireInstituteStaff: COUNSELLOR + STUDENT may place human calls (ShikshaNation counsellors)")
    void counsellorEnrolledAsStudentIsInstituteStaff() {
        assertDoesNotThrow(() -> validator.requireInstituteStaff(principal(false, "STUDENT", "counsellor"), INSTITUTE));
    }

    @Test
    @DisplayName("requireInstituteStaff: STUDENT + TEACHER is still refused")
    void studentWithTeacherNotInstituteStaff() {
        assertThrows(ForbiddenException.class,
                () -> validator.requireInstituteStaff(principal(false, "STUDENT", "TEACHER"), INSTITUTE));
    }

    @Test
    @DisplayName("TEACHER is allowed (case-insensitive)")
    void teacherAllowed() {
        assertDoesNotThrow(() -> validator.requireStaffAccess(principal(false, "teacher"), INSTITUTE));
    }

    @Test
    @DisplayName("a custom institute role with no built-in name is allowed as staff")
    void customRoleAllowed() {
        assertDoesNotThrow(() -> validator.requireStaffAccess(principal(false, "COUNSELLOR"), INSTITUTE));
    }

    @Test
    @DisplayName("root user is allowed without membership or a clientId header")
    void rootAllowed() {
        RequestContextHolder.resetRequestAttributes();
        assertDoesNotThrow(() -> validator.requireStaffAccess(principal(true), INSTITUTE));
    }

    @Test
    @DisplayName("empty authorities are denied (membership check refuses them first)")
    void emptyDenied() {
        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> validator.requireStaffAccess(principal(false), INSTITUTE));
        assertTrue(ex instanceof VacademyException || ex instanceof ForbiddenException,
                "expected an access-denied exception, got " + ex.getClass().getSimpleName());
    }

    @Test
    @DisplayName("a staff member of ANOTHER institute (clientId mismatch) is denied")
    void crossTenantDenied() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", "inst-other");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        assertThrows(VacademyException.class,
                () -> validator.requireStaffAccess(principal(false, "ADMIN"), INSTITUTE));
    }
}
