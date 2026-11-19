package vacademy.io.admin_core_service.core.security;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

/**
 * HR & payroll access: membership is proven by the clientId-header authorities (no root
 * shortcut), HR roles come from the authorities, and allowlisted super admins pass.
 * HR_ADMIN, HR_MANAGER and employee self-service keep working.
 */
class HrAccessGuardMembershipTest {

    private static final String INSTITUTE = "inst-1";
    private static final String SUPER_ADMIN_ID = "ops-1";

    private HrAccessGuard guard;
    private EmployeeProfileRepository employees;

    @BeforeEach
    void setUp() {
        InstituteAccessValidator validator = new InstituteAccessValidator() {
            @Override
            public boolean isPlatformSuperAdmin(CustomUserDetails user) {
                return user != null && SUPER_ADMIN_ID.equals(user.getUserId());
            }
        };
        employees = Mockito.mock(EmployeeProfileRepository.class);
        ReflectionTestUtils.setField(validator, "instituteGuardsEnforced", true);
        guard = new HrAccessGuard();
        ReflectionTestUtils.setField(guard, "instituteAccessValidator", validator);
        ReflectionTestUtils.setField(guard, "employeeProfileRepository", employees);
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

    private static EmployeeProfile employee(String id, String userId, String instituteId) {
        EmployeeProfile profile = new EmployeeProfile();
        profile.setId(id);
        profile.setUserId(userId);
        profile.setInstituteId(instituteId);
        return profile;
    }

    @Test
    @DisplayName("ADMIN and HR_ADMIN pass the HR admin check; HR_MANAGER passes HR staff only")
    void hrRolesKeepWorking() {
        assertDoesNotThrow(() -> guard.requireHrAdmin(principal("u-1", true, "ADMIN"), INSTITUTE));
        assertDoesNotThrow(() -> guard.requireHrAdmin(principal("u-2", false, "HR_ADMIN"), INSTITUTE));
        assertDoesNotThrow(() -> guard.requireHrStaff(principal("u-3", false, "HR_MANAGER"), INSTITUTE));
        assertThrows(ForbiddenException.class,
                () -> guard.requireHrAdmin(principal("u-3", false, "HR_MANAGER"), INSTITUTE));
    }

    @Test
    @DisplayName("a root-flag account without an HR role is no longer HR staff")
    void rootFlagIsNotAnHrRole() {
        CustomUserDetails rootLearner = principal("u-4", true, "STUDENT");
        assertFalse(guard.isHrStaff(rootLearner));
        assertThrows(ForbiddenException.class, () -> guard.requireHrStaff(rootLearner, INSTITUTE));
        assertThrows(ForbiddenException.class, () -> guard.requireHrAdmin(rootLearner, INSTITUTE));
    }

    @Test
    @DisplayName("HR_ADMIN of another institute (clientId mismatch) is refused, root flag or not")
    void otherInstituteRefused() {
        clientIdHeader("inst-other");
        assertThrows(ForbiddenException.class,
                () -> guard.requireHrAdmin(principal("u-2", true, "HR_ADMIN"), INSTITUTE));
        assertThrows(ForbiddenException.class,
                () -> guard.validateMember(principal("u-2", true, "ADMIN"), INSTITUTE));
    }

    @Test
    @DisplayName("employee self-service: own profile passes, someone else's is refused")
    void selfServiceKeepsWorking() {
        CustomUserDetails me = principal("u-5", false, "TEACHER");
        EmployeeProfile mine = employee("e-5", "u-5", INSTITUTE);
        when(employees.findByUserIdAndInstituteId("u-5", INSTITUTE)).thenReturn(Optional.of(mine));
        when(employees.findById("e-5")).thenReturn(Optional.of(mine));
        when(employees.findById("e-6")).thenReturn(Optional.of(employee("e-6", "u-6", INSTITUTE)));

        assertEquals("e-5", guard.resolveSelfEmployee(me, INSTITUTE).getId());
        assertEquals("e-5", guard.requireSelfOrHrStaff(me, INSTITUTE, "e-5").getId());
        assertThrows(ForbiddenException.class, () -> guard.requireSelfOrHrStaff(me, INSTITUTE, "e-6"));
    }

    @Test
    @DisplayName("enforcement off: root-flag account keeps the previous HR access and the change is logged")
    void previousBehaviourWhenNotEnforced() {
        InstituteAccessValidator validator =
                (InstituteAccessValidator) ReflectionTestUtils.getField(guard, "instituteAccessValidator");
        ReflectionTestUtils.setField(validator, "instituteGuardsEnforced", false);
        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            CustomUserDetails rootLearner = principal("u-4", true, "STUDENT");
            assertTrue(guard.isHrStaff(rootLearner));
            assertDoesNotThrow(() -> guard.requireHrAdmin(rootLearner, INSTITUTE));

            // Other institute with the root flag: the previous membership check let it through.
            clientIdHeader("inst-other");
            assertDoesNotThrow(() -> guard.requireHrAdmin(principal("u-2", true, "HR_ADMIN"), INSTITUTE));

            // Not root, no HR role: refused before and now.
            clientIdHeader(INSTITUTE);
            assertThrows(ForbiddenException.class,
                    () -> guard.requireHrStaff(principal("u-7", false, "TEACHER"), INSTITUTE));

            assertTrue(logs.list.stream().anyMatch(e -> e.getFormattedMessage().startsWith(
                    "INSTITUTE_GUARD_WOULD_REFUSE route=hr.requireHrAdmin user=u-4")));
            assertTrue(logs.list.stream().anyMatch(e -> e.getFormattedMessage().startsWith(
                    "INSTITUTE_GUARD_WOULD_REFUSE route=hr.requireHrAdmin user=u-2 institute=inst-1 reason=not_member")));
        } finally {
            ((Logger) LoggerFactory.getLogger(InstituteAccessValidator.class)).detachAppender(logs);
        }
    }

    private static ListAppender<ILoggingEvent> captureLogs() {
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        ((Logger) LoggerFactory.getLogger(InstituteAccessValidator.class)).addAppender(appender);
        return appender;
    }

    @Test
    @DisplayName("allowlisted super admin passes membership and role checks")
    void superAdminAllowed() {
        clientIdHeader(null);
        CustomUserDetails ops = principal(SUPER_ADMIN_ID, false);
        assertTrue(guard.isHrAdmin(ops));
        assertDoesNotThrow(() -> guard.requireHrAdmin(ops, INSTITUTE));
        assertDoesNotThrow(() -> guard.requireHrStaff(ops, INSTITUTE));
    }
}
