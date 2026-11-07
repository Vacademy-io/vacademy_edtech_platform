package vacademy.io.auth_service.feature.user.controller;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.user.dto.CreateRoleDTO;
import vacademy.io.auth_service.feature.user.dto.UpdateRoleDTO;
import vacademy.io.auth_service.feature.user.repository.UserInstituteRoleRepository;
import vacademy.io.auth_service.feature.user.repository.UserInstituteRoleRepository.InstituteRoleRow;
import vacademy.io.auth_service.feature.user.service.CustomRoleService;
import vacademy.io.auth_service.feature.user.service.UserAccountAccessGuard;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * /auth-service/v1/institute/{instituteId}/roles had no caller check at all: any signed-in user
 * could create, rewrite or delete any institute's custom roles (and their permissions). The real
 * {@link UserAccountAccessGuard} runs here against a mocked user_role view, so these pin the
 * decisions, not just the wiring. Callers are non-root and SUPER_ADMIN_USER_IDS is unset, so
 * nobody passes as a super-admin.
 */
class CustomRoleControllerGuardTest {

    private static final String A = "inst-a";
    private static final String B = "inst-b";

    private final UserInstituteRoleRepository repo = mock(UserInstituteRoleRepository.class);
    private final CustomRoleService service = mock(CustomRoleService.class);
    private final CustomRoleController controller = new CustomRoleController();
    private final Map<String, List<InstituteRoleRow>> rows = new HashMap<>();

    CustomRoleControllerGuardTest() {
        when(repo.findInstituteRolesByUserId(anyString()))
                .thenAnswer(inv -> rows.getOrDefault(inv.getArgument(0, String.class), List.of()));
        ReflectionTestUtils.setField(controller, "customRoleService", service);
        ReflectionTestUtils.setField(controller, "userAccountAccessGuard", new UserAccountAccessGuard(repo));
    }

    private void role(String userId, String institute, String roleName, String status) {
        rows.computeIfAbsent(userId, k -> new ArrayList<>()).add(new InstituteRoleRow() {
            public String getInstituteId() { return institute; }
            public String getRoleName() { return roleName; }
            public String getStatus() { return status; }
        });
    }

    private void role(String userId, String institute, String roleName) {
        role(userId, institute, roleName, "ACTIVE");
    }

    private static CustomUserDetails caller(String userId) {
        User user = new User();
        user.setId(userId);
        user.setUsername(userId);
        // Root flag set on purpose: learners and invited staff are root users, it must grant nothing.
        user.setRootUser(true);
        return new CustomUserDetails(user, A, List.of());
    }

    private static CreateRoleDTO create(String name, String... permissionIds) {
        CreateRoleDTO dto = new CreateRoleDTO();
        dto.setName(name);
        dto.setPermissionIds(List.of(permissionIds));
        return dto;
    }

    private static UpdateRoleDTO update(String name, String... permissionIds) {
        UpdateRoleDTO dto = new UpdateRoleDTO();
        dto.setName(name);
        dto.setPermissionIds(List.of(permissionIds));
        return dto;
    }

    // ---- create ------------------------------------------------------------------

    @Test
    void adminMayCreateARoleWithAnyPermissions() {
        role("admin", A, "ADMIN");
        CreateRoleDTO dto = create("Ops", "109", "7", "42");
        assertDoesNotThrow(() -> controller.createCustomRole(A, dto, caller("admin")));
        verify(service).createCustomRole(eq(A), eq(dto));
    }

    @Test
    void invitedAdminMayCreate() {
        role("admin", A, "ADMIN", "INVITED");
        assertDoesNotThrow(() -> controller.createCustomRole(A, create("Ops", "7"), caller("admin")));
    }

    @Test
    void subOrgAdminMayCreateTheFacultyAccessRoleTheTeamFormSends() {
        // A sub-org admin holds a custom role in the parent institute, not ADMIN.
        role("partner", A, "Channel Partner");
        assertDoesNotThrow(() -> controller.createCustomRole(A, create("Field Agent", "109"), caller("partner")));
        assertDoesNotThrow(() -> controller.createCustomRole(A, create("Field Agent 2"), caller("partner")));
    }

    @Test
    void nonAdminStaffCannotCreateARoleWithOtherPermissions() {
        role("teacher", A, "TEACHER");
        assertThrows(VacademyException.class,
                () -> controller.createCustomRole(A, create("Escalated", "109", "7"), caller("teacher")));
        verifyNoInteractions(service);
    }

    @Test
    void learnerCannotCreateARole() {
        role("learner", A, "STUDENT");
        assertThrows(VacademyException.class,
                () -> controller.createCustomRole(A, create("Mine", "109"), caller("learner")));
        verifyNoInteractions(service);
    }

    @Test
    void selfSignupLearnerWithTeacherIsNotStaff() {
        role("selfsignup", A, "STUDENT");
        role("selfsignup", A, "TEACHER");
        assertThrows(VacademyException.class,
                () -> controller.createCustomRole(A, create("Mine", "109"), caller("selfsignup")));
        verifyNoInteractions(service);
    }

    @Test
    void adminOfAnotherInstituteCannotCreateHere() {
        role("admin", B, "ADMIN");
        assertThrows(VacademyException.class,
                () -> controller.createCustomRole(A, create("Ops"), caller("admin")));
        verifyNoInteractions(service);
    }

    @Test
    void disabledAdminRowGrantsNothing() {
        role("admin", A, "ADMIN", "DISABLED");
        assertThrows(VacademyException.class,
                () -> controller.createCustomRole(A, create("Ops", "7"), caller("admin")));
        verifyNoInteractions(service);
    }

    // ---- update / delete -----------------------------------------------------------

    @Test
    void onlyAnAdminMayUpdateOrDelete() {
        role("admin", A, "ADMIN");
        role("teacher", A, "TEACHER");
        role("partner", A, "Channel Partner");

        assertThrows(VacademyException.class,
                () -> controller.updateCustomRole(A, "r1", update("X", "109"), caller("teacher")));
        assertThrows(VacademyException.class,
                () -> controller.updateCustomRole(A, "r1", update("X", "109"), caller("partner")));
        assertThrows(VacademyException.class, () -> controller.deleteCustomRole(A, "r1", caller("teacher")));
        verifyNoInteractions(service);

        assertDoesNotThrow(() -> controller.updateCustomRole(A, "r1", update("X", "7"), caller("admin")));
        assertDoesNotThrow(() -> controller.deleteCustomRole(A, "r1", caller("admin")));
    }

    @Test
    void adminOfAnotherInstituteCannotUpdateOrDeleteHere() {
        role("admin", B, "ADMIN");
        assertThrows(VacademyException.class,
                () -> controller.updateCustomRole(A, "r1", update("X"), caller("admin")));
        assertThrows(VacademyException.class, () -> controller.deleteCustomRole(A, "r1", caller("admin")));
        verifyNoInteractions(service);
    }

    // ---- list -----------------------------------------------------------------------

    @Test
    void anyMemberMayListButAnOutsiderMayNot() {
        role("teacher", A, "TEACHER");
        role("learner", A, "STUDENT");
        role("outsider", B, "ADMIN");
        assertDoesNotThrow(() -> controller.getRolesForInstitute(A, caller("teacher")));
        assertDoesNotThrow(() -> controller.getRolesForInstitute(A, caller("learner")));
        assertThrows(VacademyException.class, () -> controller.getRolesForInstitute(A, caller("outsider")));
    }

    @Test
    void deletedMembershipCannotList() {
        role("former", A, "TEACHER", "DELETED");
        assertThrows(VacademyException.class, () -> controller.getRolesForInstitute(A, caller("former")));
    }
}
