package vacademy.io.auth_service.feature.user.controller;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.user.dto.UserRoleFilterDTO;
import vacademy.io.auth_service.feature.user.service.AdminRoleGrantGuard;
import vacademy.io.auth_service.feature.user.service.RoleService;
import vacademy.io.auth_service.feature.user.service.UserAccountAccessGuard;
import vacademy.io.auth_service.feature.user.service.UserOperationService;
import vacademy.io.common.auth.dto.PagedUserWithRolesResponse;
import vacademy.io.common.auth.dto.UserCredentials;
import vacademy.io.common.auth.dto.UserTopLevelDto;
import vacademy.io.common.auth.dto.UserWithRolesDTO;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Set;
import java.util.function.BooleanSupplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * update-password, user-details/update and users-of-status let any signed-in user set any
 * user's password, rewrite any user's email or roles, or read every member's password. These
 * check the endpoints consult {@link UserAccountAccessGuard} before doing anything.
 */
class AccountEndpointGuardWiringTest {

    private final UserAccountAccessGuard guard = mock(UserAccountAccessGuard.class);
    private final CustomUserDetails caller = caller("attacker");

    private static CustomUserDetails caller(String userId) {
        User user = new User();
        user.setId(userId);
        user.setUsername(userId);
        return new CustomUserDetails(user, "inst-a", List.of());
    }

    private static VacademyException denied() {
        return new VacademyException(HttpStatus.FORBIDDEN, "no");
    }

    @Test
    void updatePasswordStopsBeforeTheWrite() {
        UserOperationService service = mock(UserOperationService.class);
        UserOperationController controller = new UserOperationController();
        ReflectionTestUtils.setField(controller, "userOperationService", service);
        ReflectionTestUtils.setField(controller, "userAccountAccessGuard", guard);
        doThrow(denied()).when(guard).requireCanChangeCredentials(caller, "victim");

        UserCredentials body = new UserCredentials();
        body.setUserId("victim");
        body.setPassword("pwned");
        assertThrows(VacademyException.class, () -> controller.updatePassword(body, caller));
        verifyNoInteractions(service);
    }

    @Test
    void userDetailsUpdateStopsBeforeTheWriteAndChecksTheEmail() {
        UserService userService = mock(UserService.class);
        UserDetailController controller = new UserDetailController();
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "userAccountAccessGuard", guard);
        ReflectionTestUtils.setField(controller, "adminRoleGrantGuard", mock(AdminRoleGrantGuard.class));

        User stored = new User();
        stored.setId("victim");
        stored.setEmail("victim@example.com");
        when(userService.getOptionalUserById("victim")).thenReturn(java.util.Optional.of(stored));
        boolean[] sawEmailChange = {false};
        doAnswer(inv -> {
            sawEmailChange[0] = inv.getArgument(3, BooleanSupplier.class).getAsBoolean();
            throw denied();
        }).when(guard).requireCanUpdateDetails(eq(caller), eq("inst-b"), eq("victim"), any(), any(), any());

        UserTopLevelDto body = new UserTopLevelDto();
        body.setEmail("attacker@example.com");
        body.setAddUserRoleRequest(List.of("ADMIN"));
        body.setDeleteUserRoleRequest(List.of());
        assertThrows(VacademyException.class,
                () -> controller.updateUserDetails(caller, body, "victim", "inst-b"));
        assertTrue(sawEmailChange[0]);
        org.mockito.Mockito.verify(userService, org.mockito.Mockito.never())
                .updateUserDetails(any(CustomUserDetails.class), any(), any(), any());
    }

    @Test
    void usersOfStatusDropsPasswordsTheCallerMayNotSee() {
        RoleService roleService = mock(RoleService.class);
        RoleController controller = new RoleController(roleService, mock(AdminRoleGrantGuard.class), guard);
        UserWithRolesDTO learner = new UserWithRolesDTO();
        learner.setId("learner");
        learner.setPassword("l-pass");
        UserWithRolesDTO admin = new UserWithRolesDTO();
        admin.setId("admin");
        admin.setPassword("a-pass");
        when(roleService.getUsersByInstituteIdAndStatusPaged(eq("inst-a"), any(), eq(caller)))
                .thenReturn(PagedUserWithRolesResponse.builder().content(List.of(learner, admin)).build());
        when(guard.loginsCallerMayView(eq(caller), anyCollection())).thenReturn(Set.of("learner"));

        PagedUserWithRolesResponse response =
                controller.getUsersOfStatus(new UserRoleFilterDTO(), "inst-a", null, null, caller).getBody();
        assertEquals("l-pass", response.getContent().get(0).getPassword());
        assertNull(response.getContent().get(1).getPassword());
    }
}
