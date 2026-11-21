package vacademy.io.auth_service.feature.auth.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.service.AuthService;
import vacademy.io.auth_service.feature.auth.service.TrustedLoginEligibility;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.entity.RefreshToken;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.service.RefreshTokenService;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Public learner register for an account that already existed: a learner is signed in as
 * before; an account with staff access is enrolled but not signed in; and when the role
 * lookup fails the learner is signed in as before (the lookup never refuses on its own).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LearnerRegisterExistingAccountTest {

    @Mock AuthService authService;
    @Mock InstitutePolicyService institutePolicyService;
    @Mock InternalClientUtils internalClientUtils;
    @Mock RefreshTokenService refreshTokenService;
    @Mock TrustedLoginEligibility eligibility;

    @InjectMocks LearnerAuthManager manager;

    private final User existing = User.builder().id("u-1").username("asha").email("asha@example.com").build();

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(manager, "trustedLoginEligibility", eligibility);
        when(authService.createOrGetLearnerForSelfSignup(any(UserDTO.class), eq("inst-1"), anyBoolean()))
                .thenReturn(new AuthService.AccountResult(existing, false));
        RefreshToken refreshToken = new RefreshToken();
        refreshToken.setToken("refresh");
        when(refreshTokenService.createRefreshToken(any(), any())).thenReturn(refreshToken);
        when(authService.generateJwtTokenForUser(eq(existing), eq(refreshToken), anyList()))
                .thenReturn(JwtResponseDto.builder().accessToken("access").refreshToken("refresh").build());
    }

    private JwtResponseDto register() {
        UserDTO user = new UserDTO();
        user.setEmail("asha@example.com");
        user.setFullName("Asha");
        LearnerEnrollRequestDTO request = new LearnerEnrollRequestDTO();
        request.setUser(user);
        request.setInstituteId("inst-1");
        return manager.registerLearner(request);
    }

    @Test
    void existingLearnerIsSignedIn() {
        when(eligibility.nonLearnerAccess(existing)).thenReturn(List.of());
        JwtResponseDto answer = register();
        assertEquals("access", answer.getAccessToken());
        assertNull(answer.getAccountExists());
    }

    @Test
    void existingStaffAccountIsNotSignedIn() {
        when(eligibility.nonLearnerAccess(existing)).thenReturn(List.of("ADMIN"));
        JwtResponseDto answer = register();
        assertNull(answer.getAccessToken());
        assertTrue(answer.getAccountExists());
        verify(refreshTokenService, never()).createRefreshToken(any(), any());
    }

    @Test
    void failedRoleLookupSignsInAsBefore() {
        when(eligibility.nonLearnerAccess(existing)).thenThrow(new RuntimeException("db down"));
        JwtResponseDto answer = register();
        assertEquals("access", answer.getAccessToken());
        assertNull(answer.getAccountExists());
    }
}
