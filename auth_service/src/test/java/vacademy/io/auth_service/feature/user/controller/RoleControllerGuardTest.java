package vacademy.io.auth_service.feature.user.controller;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.auth_service.feature.user.dto.ModifyUserRolesDTO;
import vacademy.io.auth_service.feature.user.service.AdminRoleGrantGuard;
import vacademy.io.auth_service.feature.user.service.RoleService;
import vacademy.io.auth_service.feature.user.service.UserAccountAccessGuard;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * remove-user-roles and update-role-status had no guard at all: any signed-in user could strip
 * or disable anyone's roles in any institute. Both now ask the guards before the service runs.
 */
class RoleControllerGuardTest {

    private final RoleService roleService = mock(RoleService.class);
    private final AdminRoleGrantGuard adminGuard = mock(AdminRoleGrantGuard.class);
    private final UserAccountAccessGuard guard = mock(UserAccountAccessGuard.class);
    private final RoleController controller = new RoleController(roleService, adminGuard, guard);
    private final CustomUserDetails caller = caller();

    private static CustomUserDetails caller() {
        User user = new User();
        user.setId("attacker");
        user.setUsername("attacker");
        return new CustomUserDetails(user, "inst-a", List.of());
    }

    private static ModifyUserRolesDTO body() {
        ModifyUserRolesDTO d = new ModifyUserRolesDTO();
        d.setUserId("victim");
        d.setInstituteId("inst-a");
        d.setRoles(List.of("ADMIN"));
        return d;
    }

    @Test
    void removeRolesNeedsStaffOfTheInstitute() {
        doThrow(new VacademyException(HttpStatus.FORBIDDEN, "no")).when(guard).requireStaffOf(caller, "inst-a");
        assertThrows(VacademyException.class, () -> controller.removeUserRoles(body(), caller));
        verifyNoInteractions(roleService);
    }

    @Test
    void removingAdminNeedsAnAdmin() {
        doThrow(new VacademyException(HttpStatus.FORBIDDEN, "no")).when(adminGuard)
                .requireAdminToRemoveAdmin(eq(caller), eq("inst-a"), anyCollection());
        assertThrows(VacademyException.class, () -> controller.removeUserRoles(body(), caller));
        verifyNoInteractions(roleService);
    }

    @Test
    void anAllowedRemovalReachesTheService() {
        controller.removeUserRoles(body(), caller);
        verify(roleService).removeRolesFromUser(any(), eq(caller));
    }

    @Test
    void roleStatusChangeAsksTheGuardFirst() {
        doThrow(new VacademyException(HttpStatus.FORBIDDEN, "no")).when(guard)
                .requireCanChangeRoleStatus(caller, "inst-b", List.of("victim"), "DISABLED");
        assertThrows(VacademyException.class,
                () -> controller.updateUserRoleStatus("inst-b", List.of("victim"), "DISABLED", caller));
        verifyNoInteractions(roleService);
    }
}
