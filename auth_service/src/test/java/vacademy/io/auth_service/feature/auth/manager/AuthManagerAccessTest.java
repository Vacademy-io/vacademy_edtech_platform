package vacademy.io.auth_service.feature.auth.manager;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import vacademy.io.auth_service.feature.auth.dto.AuthRequestDto;
import vacademy.io.auth_service.feature.demo.service.TrialAccessGuard;
import vacademy.io.common.auth.dto.RefreshTokenRequestDTO;
import vacademy.io.common.auth.entity.RefreshToken;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserPermissionRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.RefreshTokenService;
import vacademy.io.common.exceptions.ExpiredTokenException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Sign-in and token renewal must respect "Disable access": renewal stops once every role is
 * revoked, role-less accounts keep renewing as before, and signing in only accepts pending
 * invites — it never re-enables what an admin switched off.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AuthManagerAccessTest {

    @Mock RefreshTokenService refreshTokenService;
    @Mock UserRoleRepository userRoleRepository;
    @Mock UserPermissionRepository userPermissionRepository;
    @Mock JwtService jwtService;
    @Mock AuthenticationManager authenticationManager;
    @Mock UserRepository userRepository;
    @Mock TrialAccessGuard trialAccessGuard;

    @InjectMocks AuthManager authManager;

    private static UserRole role(String name, String instituteId, String status) {
        Role role = new Role();
        role.setName(name);
        UserRole userRole = new UserRole();
        userRole.setRole(role);
        userRole.setInstituteId(instituteId);
        userRole.setStatus(status);
        return userRole;
    }

    private User user() {
        User user = new User();
        user.setId("u1");
        user.setUsername("priya");
        return user;
    }

    private RefreshTokenRequestDTO refreshWith(List<UserRole> roles) {
        User user = user();
        RefreshToken token = new RefreshToken();
        token.setUserInfo(user);
        when(refreshTokenService.findByToken("rt")).thenReturn(Optional.of(token));
        when(refreshTokenService.verifyExpiration(token)).thenReturn(token);
        when(userRoleRepository.findByUser(user)).thenReturn(roles);
        when(userPermissionRepository.findByUserId("u1")).thenReturn(List.of());
        when(jwtService.generateToken(any(User.class), anyList(), anyList())).thenReturn("new-access");
        RefreshTokenRequestDTO request = new RefreshTokenRequestDTO();
        request.setToken("rt");
        return request;
    }

    @Test
    void refreshStopsWhenEveryRoleIsRevoked() {
        RefreshTokenRequestDTO request = refreshWith(
                List.of(role("TEACHER", "a", "DISABLED"), role("STUDENT", "a", "DELETE")));
        assertThrows(ExpiredTokenException.class, () -> authManager.refreshToken(request));
    }

    @Test
    void refreshContinuesWhileAnyRoleIsLive() {
        RefreshTokenRequestDTO request = refreshWith(
                List.of(role("TEACHER", "a", "DISABLED"), role("ADMIN", "b", "ACTIVE")));
        assertEquals("new-access", authManager.refreshToken(request).getAccessToken());
    }

    @Test
    void refreshKeepsOldBehaviourForRoleLessAccounts() {
        RefreshTokenRequestDTO request = refreshWith(List.of());
        assertEquals("new-access", authManager.refreshToken(request).getAccessToken());
    }

    @Test
    void passwordSignInOnlyAcceptsInvitesAndPrefersTheRequestedInstitute() {
        User user = user();
        Authentication authenticated = new UsernamePasswordAuthenticationToken("priya", null, List.of());
        when(authenticationManager.authenticate(any())).thenReturn(authenticated);
        when(userRepository.findByUsername("priya")).thenReturn(Optional.of(user));
        List<UserRole> roles = List.of(
                role("ADMIN", "other", "ACTIVE"), role("TEACHER", "requested", "INVITED"),
                role("EVALUATOR", "requested", "DELETE"));
        user.setRoles(new java.util.HashSet<>(roles));
        when(userRoleRepository.findByUser(user)).thenReturn(roles);
        RefreshToken token = new RefreshToken();
        token.setToken("rt");
        when(refreshTokenService.createRefreshToken(anyString(), any())).thenReturn(token);
        when(jwtService.generateToken(any(User.class), anyList(), anyList())).thenReturn("access");

        AuthRequestDto request = new AuthRequestDto();
        request.setUserName("priya");
        request.setPassword("secret");
        request.setInstituteId("requested");
        authManager.loginUser(request);

        verify(userRoleRepository).activateInvitedRolesByInstituteIdAndUserId("requested", List.of("u1"));
        verify(userRoleRepository, never()).updateUserRoleStatusByInstituteIdAndUserId(anyString(), anyString(),
                anyList());
    }

    @Test
    void passwordSignInIsRefusedWithNoLiveStaffRole() {
        User user = user();
        when(authenticationManager.authenticate(any()))
                .thenReturn(new UsernamePasswordAuthenticationToken("priya", null, List.of()));
        when(userRepository.findByUsername("priya")).thenReturn(Optional.of(user));
        when(userRoleRepository.findByUser(user)).thenReturn(
                List.of(role("TEACHER", "a", "DISABLED"), role("STUDENT", "a", "ACTIVE")));

        AuthRequestDto request = new AuthRequestDto();
        request.setUserName("priya");
        request.setPassword("secret");
        request.setInstituteId("a");
        assertThrows(RuntimeException.class, () -> authManager.loginUser(request));
        verify(userRoleRepository, never()).activateInvitedRolesByInstituteIdAndUserId(anyString(), anyList());
    }
}
