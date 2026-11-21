package vacademy.io.auth_service.feature.auth.manager;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.service.TrustedLoginEligibility;
import vacademy.io.auth_service.feature.login_link.service.LoginCodeService;
import vacademy.io.common.auth.entity.RefreshToken;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserPermissionRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.RefreshTokenService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Username-only trusted login (join links): accounts with staff/admin access or super-admins
 * are refused only while security.trusted-login.block-staff-accounts is on, and logged either way.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LearnerAuthManagerTrustedLoginTest {

    @Mock UserRepository userRepository;
    @Mock RefreshTokenService refreshTokenService;
    @Mock UserPermissionRepository userPermissionRepository;
    @Mock JwtService jwtService;
    @Mock LoginCodeService loginCodeService;
    @Mock TrustedLoginEligibility eligibility;

    @InjectMocks LearnerAuthManager manager;

    private ListAppender<ILoggingEvent> logs;
    private final Logger managerLog = (Logger) LoggerFactory.getLogger(LearnerAuthManager.class);

    private final User account = account();

    private static User account() {
        Role role = new Role();
        role.setName("STUDENT");
        UserRole studentRole = new UserRole();
        studentRole.setRole(role);
        studentRole.setStatus("ACTIVE");
        User user = User.builder().id("u-1").username("asha").build();
        user.setRoles(new HashSet<>(List.of(studentRole)));
        return user;
    }

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(manager, "trustedLoginEnabled", true);
        ReflectionTestUtils.setField(manager, "trustedLoginEligibility", eligibility);
        when(userRepository.findByUsername("asha")).thenReturn(Optional.of(account));
        when(loginCodeService.anyInstituteRequiresCode(anyString(), any(), any())).thenReturn(false);
        when(userPermissionRepository.findByUserId(any())).thenReturn(List.of());
        when(jwtService.generateToken(any(User.class), anyList(), anyList(), anyInt())).thenReturn("access");
        RefreshToken refreshToken = new RefreshToken();
        refreshToken.setToken("refresh");
        when(refreshTokenService.createRefreshToken(any(), any())).thenReturn(refreshToken);

        logs = new ListAppender<>();
        logs.start();
        managerLog.addAppender(logs);
    }

    @AfterEach
    void tearDown() {
        managerLog.detachAppender(logs);
    }

    private void blockStaff(boolean on) {
        ReflectionTestUtils.setField(manager, "trustedLoginBlockStaffAccounts", on);
    }

    private JwtResponseDto login() {
        return manager.loginByUsernameTrusted("asha", null, null, "LIVE_CLASS", "203.0.113.9");
    }

    private List<String> wouldBlockLines() {
        return logs.list.stream().map(ILoggingEvent::getFormattedMessage)
                .filter(m -> m.startsWith("TRUSTED_LOGIN_WOULD_BLOCK")).toList();
    }

    @Test
    void learnerIsSignedInWithTheSwitchOn() {
        blockStaff(true);
        when(eligibility.nonLearnerAccess(account)).thenReturn(List.of());

        JwtResponseDto tokens = login();

        assertEquals("access", tokens.getAccessToken());
        assertEquals("refresh", tokens.getRefreshToken());
        assertEquals(List.of(), wouldBlockLines());
    }

    @Test
    void staffAccountIsRefusedWithTheSwitchOn() {
        blockStaff(true);
        when(eligibility.nonLearnerAccess(account)).thenReturn(List.of("ADMIN"));

        VacademyException refused = assertThrows(VacademyException.class, this::login);

        assertEquals(HttpStatus.UNAUTHORIZED, refused.getStatus());
        assertEquals("This login link is invalid or has expired.", refused.getMessage());
        verify(refreshTokenService, never()).deleteAllRefreshToken(any());
        verify(refreshTokenService, never()).createRefreshToken(any(), any());
        assertEquals(List.of("TRUSTED_LOGIN_WOULD_BLOCK: user=u-1 roles=[ADMIN] enforced=true"), wouldBlockLines());
    }

    @Test
    void staffAccountIsSignedInAsTodayWithTheSwitchOffButLogged() {
        blockStaff(false);
        when(eligibility.nonLearnerAccess(account)).thenReturn(List.of("ADMIN", "SUPER_ADMIN"));

        JwtResponseDto tokens = login();

        assertEquals("access", tokens.getAccessToken());
        assertEquals("refresh", tokens.getRefreshToken());
        verify(refreshTokenService).deleteAllRefreshToken(account);
        assertEquals(List.of("TRUSTED_LOGIN_WOULD_BLOCK: user=u-1 roles=[ADMIN, SUPER_ADMIN] enforced=false"),
                wouldBlockLines());
        ILoggingEvent line = logs.list.stream()
                .filter(e -> e.getFormattedMessage().startsWith("TRUSTED_LOGIN_WOULD_BLOCK")).findFirst().orElseThrow();
        assertEquals(ch.qos.logback.classic.Level.INFO, line.getLevel());
        assertTrue(!line.getFormattedMessage().contains("asha"), "only the user id is logged");
    }

    @Test
    void failedCheckChangesNothingWithTheSwitchOff() {
        blockStaff(false);
        when(eligibility.nonLearnerAccess(account)).thenThrow(new RuntimeException("db down"));

        assertEquals("access", login().getAccessToken());
    }

    @Test
    void failedCheckStillSignsInWithTheSwitchOn() {
        blockStaff(true);
        when(eligibility.nonLearnerAccess(account)).thenThrow(new RuntimeException("db down"));

        assertEquals("access", login().getAccessToken());
        assertTrue(logs.list.stream().anyMatch(e -> e.getLevel() == ch.qos.logback.classic.Level.ERROR
                && e.getFormattedMessage().startsWith("TRUSTED_LOGIN_ELIGIBILITY_CHECK_FAILED: user=u-1 enforced=true")));
    }

    @Test
    void switchDefaultsToOff() throws Exception {
        LearnerAuthManager fresh = new LearnerAuthManager();
        assertEquals(false, ReflectionTestUtils.getField(fresh, "trustedLoginBlockStaffAccounts"));
        var field = LearnerAuthManager.class.getDeclaredField("trustedLoginBlockStaffAccounts");
        assertEquals("${security.trusted-login.block-staff-accounts:false}",
                field.getAnnotation(org.springframework.beans.factory.annotation.Value.class).value());
    }
}
