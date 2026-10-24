package vacademy.io.auth_service.feature.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import vacademy.io.auth_service.feature.auth.service.UserDetailsCacheService;
import vacademy.io.auth_service.feature.user.service.RoleService;
import vacademy.io.auth_service.feature.user.service.UserOperationService;
import vacademy.io.common.auth.config.JsonAuthEntryPoint;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.filter.JwtAuthFilter;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.exceptions.AccessRevokedException;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * "Disable access" / "Delete member" on the Teams tab must actually keep that person out:
 * no revoked role in a new token, no authority from one on a live token, and the per-request
 * user lookup every service uses refuses them — without touching learners or other institutes.
 */
class StaffAccessRevocationTest {

    private static final String INSTITUTE = "inst-a";
    private static final String OTHER = "inst-b";

    private static UserRole role(String name, String instituteId, String status) {
        Role role = new Role();
        role.setId("role-" + name);
        role.setName(name);
        UserRole userRole = new UserRole();
        userRole.setRole(role);
        userRole.setInstituteId(instituteId);
        userRole.setStatus(status);
        return userRole;
    }

    private static User user() {
        User user = new User();
        user.setId("u1");
        user.setUsername("priya");
        user.setFullName("Priya Sharma");
        user.setPassword("x");
        return user;
    }

    @Test
    void onlyActiveAndInvitedRolesGrantAccess() {
        assertTrue(UserRoleService.grantsAccess(role("ADMIN", INSTITUTE, "ACTIVE")));
        assertTrue(UserRoleService.grantsAccess(role("ADMIN", INSTITUTE, "INVITED")));
        for (String revoked : List.of("DISABLED", "DELETED", "DELETE", "CANCEL", "INACTIVE")) {
            assertFalse(UserRoleService.grantsAccess(role("ADMIN", INSTITUTE, revoked)), revoked);
        }
    }

    @Test
    void staffWithEveryRoleRevokedInTheInstituteIsBlocked() {
        List<UserRole> roles = List.of(role("TEACHER", INSTITUTE, "DISABLED"),
                role("STUDENT", INSTITUTE, "DISABLED"), role("ADMIN", OTHER, "ACTIVE"));
        assertTrue(UserRoleService.isStaffAccessRevoked(roles, INSTITUTE));
        // Still fine in the institute where they are active.
        assertFalse(UserRoleService.isStaffAccessRevoked(roles, OTHER));
    }

    @Test
    void oneLiveRoleKeepsAccess() {
        List<UserRole> roles = List.of(role("TEACHER", INSTITUTE, "DELETE"), role("ADMIN", INSTITUTE, "ACTIVE"));
        assertFalse(UserRoleService.isStaffAccessRevoked(roles, INSTITUTE));
    }

    @Test
    void learnersAndUnknownInstitutesAreOutOfScope() {
        assertFalse(UserRoleService.isStaffAccessRevoked(List.of(role("STUDENT", INSTITUTE, "DISABLED")), INSTITUTE));
        assertFalse(UserRoleService.isStaffAccessRevoked(List.of(role("ADMIN", OTHER, "DISABLED")), INSTITUTE));
        assertFalse(UserRoleService.isStaffAccessRevoked(List.of(role("ADMIN", INSTITUTE, "DISABLED")), null));
        assertFalse(UserRoleService.isStaffAccessRevoked(List.of(role("ADMIN", INSTITUTE, "DISABLED")), "null"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void tokenRoleMapDropsRevokedRolesAndEmptyInstitutes() {
        Map<String, Object> map = UserRoleService.createInstituteRoleMap(List.of(
                role("ADMIN", INSTITUTE, "DISABLED"),
                role("TEACHER", OTHER, "ACTIVE"),
                role("EVALUATOR", OTHER, "DELETE")));
        assertFalse(map.containsKey(INSTITUTE));
        assertEquals(List.of("TEACHER"), ((Map<String, Object>) map.get(OTHER)).get("roles"));
    }

    @Test
    void liveTokenGetsNoAuthorityFromARevokedRole() {
        CustomUserDetails details = new CustomUserDetails(user(), INSTITUTE,
                List.of(role("ADMIN", INSTITUTE, "DISABLED"), role("EVALUATOR", INSTITUTE, "ACTIVE")));
        List<String> authorities = details.getAuthorities().stream().map(Object::toString).toList();
        assertTrue(authorities.contains("EVALUATOR"));
        assertFalse(authorities.contains("ADMIN"));
    }

    @Test
    void internalUserLookupRefusesARevokedMember() {
        UserRepository users = mock(UserRepository.class);
        UserRoleRepository userRoles = mock(UserRoleRepository.class);
        User user = user();
        when(users.findByUsername("priya")).thenReturn(Optional.of(user));
        when(userRoles.findByUser(user)).thenReturn(List.of(role("TEACHER", INSTITUTE, "DISABLED")));
        UserDetailsCacheService service = new UserDetailsCacheService(users, userRoles);

        assertThrows(AccessRevokedException.class, () -> service.getCustomUserDetails("priya", INSTITUTE));
        // Same person calling for an institute they were never staff in: not this rule's business.
        assertDoesNotThrow(() -> service.getCustomUserDetails("priya", OTHER));
    }

    @Test
    void revocationIsRecognisedThroughTheRemoteCallWrapping() {
        // Other services see auth-service's 403 as an HTTP client exception whose message
        // carries the response body.
        RuntimeException remote = new RuntimeException("403 Forbidden: \"{\"ex\":\""
                + AccessRevokedException.CODE + ": access to this institute has been disabled\"}\"");
        assertTrue(AccessRevokedException.isCause(new IllegalStateException("user resolution failed", remote)));
        assertTrue(AccessRevokedException.isCause(new AccessRevokedException("x")));
        assertFalse(AccessRevokedException.isCause(new RuntimeException("I/O error: Connection refused")));
        // Body only reachable through the exception, not its (possibly truncated) message.
        org.springframework.web.client.HttpClientErrorException http =
                org.springframework.web.client.HttpClientErrorException.create(
                        org.springframework.http.HttpStatus.FORBIDDEN, "Forbidden", null,
                        ("{\"url\":\"" + "x".repeat(400) + "\",\"responseCode\":\""
                                + AccessRevokedException.CODE + "\"}").getBytes(), null);
        assertTrue(AccessRevokedException.isCause(new IllegalStateException("wrapped", http)));
    }

    @Test
    void entryPointSendsAccessRevokedOnlyForRevocation() throws Exception {
        JsonAuthEntryPoint entryPoint = new JsonAuthEntryPoint();
        ObjectMapper json = new ObjectMapper();

        MockHttpServletRequest revoked = new MockHttpServletRequest("GET", "/admin-core-service/x");
        revoked.setAttribute(JwtAuthFilter.AUTH_FAILURE_REASON, AccessRevokedException.CODE);
        MockHttpServletResponse revokedResponse = new MockHttpServletResponse();
        entryPoint.commence(revoked, revokedResponse, null);
        assertEquals(403, revokedResponse.getStatus());
        assertEquals("ACCESS_REVOKED", json.readTree(revokedResponse.getContentAsString()).get("error").asText());

        MockHttpServletRequest blip = new MockHttpServletRequest("GET", "/admin-core-service/x");
        blip.setAttribute(JwtAuthFilter.AUTH_FAILURE_REASON, "Token subject could not be matched");
        MockHttpServletResponse blipResponse = new MockHttpServletResponse();
        entryPoint.commence(blip, blipResponse, null);
        assertEquals("USER_NOT_RESOLVED", json.readTree(blipResponse.getContentAsString()).get("error").asText());
    }

    private RoleService roleService(UserRoleRepository userRoles) {
        return new RoleService(mock(RoleRepository.class), mock(UserRepository.class), userRoles,
                mock(UserService.class), mock(UserOperationService.class));
    }

    @Test
    void disablePausesOnlyLiveRoles() {
        UserRoleRepository userRoles = mock(UserRoleRepository.class);
        roleService(userRoles).updateUserRoleStatusByInstituteIdAndUserId("DISABLED", INSTITUTE, List.of("u1"), null);
        verify(userRoles).updateUserRoleStatusFromStatuses("DISABLED", List.of("ACTIVE", "INVITED"), INSTITUTE,
                List.of("u1"));
        verify(userRoles, never()).updateUserRoleStatusByInstituteIdAndUserId(anyString(), anyString(), anyList());
    }

    @Test
    void enableRestoresPausedRolesButNeverDeletedOnes() {
        UserRoleRepository userRoles = mock(UserRoleRepository.class);
        // Already enabled: nothing to move, and that is not an error.
        when(userRoles.updateUserRoleStatusFromStatuses(any(), any(), any(), any())).thenReturn(0);
        assertDoesNotThrow(() -> roleService(userRoles)
                .updateUserRoleStatusByInstituteIdAndUserId("ACTIVE", INSTITUTE, List.of("u1"), null));
        verify(userRoles).updateUserRoleStatusFromStatuses(eq("ACTIVE"), eq(List.of("DISABLED", "INACTIVE")),
                eq(INSTITUTE), eq(List.of("u1")));
    }

    @Test
    void deleteAndCancelKeepTheOldBehaviour() {
        UserRoleRepository userRoles = mock(UserRoleRepository.class);
        when(userRoles.updateUserRoleStatusByInstituteIdAndUserId("DELETE", INSTITUTE, List.of("u1"))).thenReturn(2);
        roleService(userRoles).updateUserRoleStatusByInstituteIdAndUserId("DELETE", INSTITUTE, List.of("u1"), null);
        verify(userRoles).updateUserRoleStatusByInstituteIdAndUserId("DELETE", INSTITUTE, List.of("u1"));
    }
}
