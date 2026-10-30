package vacademy.io.auth_service.feature.auth.manager;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.core.Authentication;
import vacademy.io.auth_service.feature.auth.dto.AuthRequestDto;
import vacademy.io.auth_service.feature.auth.repository.PortalUserLookupRepository;
import vacademy.io.auth_service.feature.auth.service.LearnerPortalAccessGuard;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.RefreshTokenService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.auth_service.feature.institute.service.InstituteSettingsService;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Learner sign-in on a white-label portal: a refused login must not touch the owner's sessions,
 * and OTP login must find the learner's account in the portal institute, not just the newest one.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LearnerAuthManagerPortalScopeTest {

    @Mock RefreshTokenService refreshTokenService;
    @Mock UserRepository userRepository;
    @Mock UserRoleRepository userRoleRepository;
    @Mock AuthenticationManager authenticationManager;
    @Mock NotificationService notificationService;
    @Mock InstituteSettingsService instituteSettingsService;
    @Mock LearnerPortalAccessGuard guard;
    @Mock PortalUserLookupRepository portalUserLookupRepository;

    @InjectMocks LearnerAuthManager manager;

    private static User user(String id) {
        User u = new User();
        u.setId(id);
        u.setUsername("name-" + id);
        u.setEmail("kid@example.com");
        return u;
    }

    private AuthRequestDto otpRequest() {
        AuthRequestDto dto = new AuthRequestDto();
        dto.setEmail("kid@example.com");
        dto.setOtp("123456");
        dto.setPortalInstituteId("shiksha");
        return dto;
    }

    @Test
    void passwordLoginRefusedByGuardLeavesSessionsAlone() {
        AuthRequestDto dto = new AuthRequestDto();
        dto.setUserName("ssdc-kid");
        dto.setPassword("pw");
        dto.setPortalInstituteId("shiksha");
        Authentication auth = org.mockito.Mockito.mock(Authentication.class);
        when(auth.isAuthenticated()).thenReturn(true);
        when(authenticationManager.authenticate(any())).thenReturn(auth);
        User ssdcKid = user("u-ssdc");
        when(userRepository.findByUsername(anyString())).thenReturn(Optional.of(ssdcKid));
        doThrow(new VacademyException(LearnerPortalAccessGuard.NOT_A_MEMBER_MESSAGE))
                .when(guard).assertUserBelongsToPortal(anyString(), anyString(), anyList());

        assertThrows(VacademyException.class, () -> manager.loginUser(dto));
        verify(refreshTokenService, never()).deleteAllRefreshToken(any());
    }

    @Test
    void emailOtpLoginRefusedByGuardLeavesSessionsAlone() {
        when(notificationService.verifyOTP(any())).thenReturn(true);
        when(instituteSettingsService.getUserIdentifier(any())).thenReturn("EMAIL");
        User ssdcKid = user("u-ssdc");
        when(userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(anyString(), anyList(), anyList()))
                .thenReturn(Optional.of(ssdcKid));
        when(guard.appliesTo("shiksha")).thenReturn(true);
        when(portalUserLookupRepository.findMostRecentByEmailInInstitute(anyString(), anyString(), anyList(), anyList()))
                .thenReturn(Optional.empty());
        doThrow(new VacademyException(LearnerPortalAccessGuard.NOT_A_MEMBER_MESSAGE))
                .when(guard).assertUserBelongsToPortal(anyString(), anyString(), anyList());

        assertThrows(VacademyException.class, () -> manager.loginViaOtp(otpRequest()));
        verify(refreshTokenService, never()).deleteAllRefreshToken(any());
    }

    @Test
    void emailOtpPrefersTheAccountInThePortalInstitute() {
        when(notificationService.verifyOTP(any())).thenReturn(true);
        when(instituteSettingsService.getUserIdentifier(any())).thenReturn("EMAIL");
        User newestElsewhere = user("u-ssdc");
        User ownAccount = user("u-shiksha");
        when(userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(anyString(), anyList(), anyList()))
                .thenReturn(Optional.of(newestElsewhere));
        when(guard.appliesTo("shiksha")).thenReturn(true);
        when(portalUserLookupRepository.findMostRecentByEmailInInstitute(anyString(), anyString(), anyList(), anyList()))
                .thenReturn(Optional.of(ownAccount));

        try {
            manager.loginViaOtp(otpRequest());
        } catch (RuntimeException ignoredLaterWiring) {
            // token/session collaborators are not mocked; only the account choice is under test
        }
        verify(guard).assertUserBelongsToPortal(org.mockito.ArgumentMatchers.eq("shiksha"),
                org.mockito.ArgumentMatchers.eq("u-shiksha"), anyList());
    }

    @Test
    void sharedPortalKeepsTheNewestAccountLookup() {
        when(notificationService.verifyOTP(any())).thenReturn(true);
        when(instituteSettingsService.getUserIdentifier(any())).thenReturn("EMAIL");
        User newest = user("u-newest");
        when(userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(anyString(), anyList(), anyList()))
                .thenReturn(Optional.of(newest));
        when(guard.appliesTo("shiksha")).thenReturn(false);

        try {
            manager.loginViaOtp(otpRequest());
        } catch (RuntimeException ignoredLaterWiring) {
            // see above
        }
        verify(portalUserLookupRepository, never()).findMostRecentByEmailInInstitute(any(), any(), any(), any());
        verify(guard).assertUserBelongsToPortal(org.mockito.ArgumentMatchers.eq("shiksha"),
                org.mockito.ArgumentMatchers.eq("u-newest"), anyList());
    }
}
