package vacademy.io.auth_service.feature.panel;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.controller.PanelAdminController;
import vacademy.io.auth_service.feature.panel.controller.PanelExceptionAdvice;
import vacademy.io.auth_service.feature.panel.controller.PanelPublicController;
import vacademy.io.auth_service.feature.panel.controller.PanelTeacherController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.*;
import vacademy.io.auth_service.feature.panel.filter.PanelBearerGuard;
import vacademy.io.auth_service.feature.panel.filter.PanelConcurrencyFilter;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.ChallengeRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.service.PanelAccessPolicy;
import vacademy.io.auth_service.feature.panel.service.PanelAdminService;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelChallengeService;
import vacademy.io.auth_service.feature.panel.service.PanelDevices;
import vacademy.io.auth_service.feature.panel.service.PanelInstituteDirectory;
import vacademy.io.auth_service.feature.panel.service.PanelIps;
import vacademy.io.auth_service.feature.panel.service.PanelMaintenance;
import vacademy.io.auth_service.feature.panel.service.PanelPairingService;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelRateLimiter;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;
import vacademy.io.auth_service.feature.panel.service.PanelSessionService;
import vacademy.io.auth_service.feature.panel.service.PanelTokenService;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.service.JwtService;

import java.net.URI;
import java.sql.Timestamp;
import java.util.Date;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Limits, refusals and request checks of the panel endpoints that need no database. */
class PanelHardeningTest {

    private static PanelProperties properties(boolean enabled, String allowedInstitutes, String trustedProxies) {
        return new PanelProperties(enabled, true, 1, 4, false, 9999, 30, 4, 1, "https://classroom.vacademy.io",
                allowedInstitutes, trustedProxies);
    }

    private static PanelProperties properties() {
        return properties(true, "", "");
    }

    private static DeviceRow device(String institute, boolean passwordLoginAllowed) {
        Timestamp now = new Timestamp(System.currentTimeMillis());
        return new DeviceRow("dev-1", institute, "room-1", "Room 1", PanelSecrets.sha256Hex("secret"), "ACTIVE",
                "Alpha", "blue", null, now, passwordLoginAllowed, "Lab", "Panel", 28, 66, 2, now, "1.1.1.1",
                "Admin", now, now);
    }

    private static String code(Runnable call) {
        try {
            call.run();
        } catch (PanelApiException e) {
            return e.getCode();
        }
        return "OK";
    }

    @SuppressWarnings("unchecked")
    private static PanelTx inlineTx() {
        PanelTx tx = mock(PanelTx.class);
        when(tx.run(any())).thenAnswer(call -> ((Supplier<Object>) call.getArgument(0)).get());
        return tx;
    }

    private static CustomUserDetails principal(String userId) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn(userId);
        when(user.getFullName()).thenReturn("Tara Teacher");
        return user;
    }

    // ------------------------------------------------------------ limiter ---

    @Nested
    class Limiter {
        @Test
        void aFullKindRefusesNewKeysAndNeverResetsAnotherKind() {
            PanelRateLimiter limiter = new PanelRateLimiter(properties());
            for (int i = 0; i < PanelRateLimiter.LOGIN_PASSWORD_PER_KEY; i++) {
                limiter.check("login_password", "dev:user", PanelRateLimiter.LOGIN_PASSWORD_PER_KEY);
            }
            for (int i = 0; i < PanelRateLimiter.MAX_KEYS_PER_KIND; i++) {
                limiter.check("pair_start", "ip-" + i, PanelRateLimiter.PAIR_START_PER_IP);
            }
            assertThat(code(() -> limiter.check("pair_start", "one-more", PanelRateLimiter.PAIR_START_PER_IP)))
                    .isEqualTo("RATE_LIMITED");
            assertThat(limiter.trackedKeys("pair_start")).isEqualTo(PanelRateLimiter.MAX_KEYS_PER_KIND);
            assertThat(code(() -> limiter.check("login_password", "dev:user", PanelRateLimiter.LOGIN_PASSWORD_PER_KEY)))
                    .as("a flood of another kind must not reset this count").isEqualTo("RATE_LIMITED");
            limiter.check("pair_start", "ip-7", PanelRateLimiter.PAIR_START_PER_IP);
        }

        @Test
        void ipv6IsCountedPerSlash64() {
            PanelRateLimiter limiter = new PanelRateLimiter(properties());
            for (int i = 0; i < 30; i++) {
                limiter.checkIp("pair_start", "2001:db8:1:2::" + Integer.toHexString(i + 1), 30);
            }
            assertThat(code(() -> limiter.checkIp("pair_start", "2001:db8:1:2:ffff:ffff:ffff:ffff", 30)))
                    .isEqualTo("RATE_LIMITED");
            limiter.checkIp("pair_start", "2001:db8:1:3::1", 30);
            limiter.checkIp("pair_start", "203.0.113.9", 30);
        }

        @Test
        void limitKeysOfAddresses() {
            assertThat(PanelIps.limitKey("2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd")).isEqualTo("2001:db8:1:2::/64");
            assertThat(PanelIps.limitKey("[2001:db8::1]")).isEqualTo("2001:db8:0:0::/64");
            assertThat(PanelIps.limitKey("::ffff:203.0.113.9")).isEqualTo("203.0.113.9");
            assertThat(PanelIps.limitKey("203.0.113.9")).isEqualTo("203.0.113.9");
            assertThat(PanelIps.limitKey("not-an-address")).isEqualTo("not-an-address");
            assertThat(PanelIps.limitKey("1:2:3")).isEqualTo("1:2:3");
            assertThat(PanelIps.address("1.2.3")).isNull();
            assertThat(PanelIps.address("256.1.1.1")).isNull();
            assertThat(PanelIps.address("1::2::3")).isNull();
            assertThat(PanelIps.address("example.com")).isNull();
        }

        @Test
        void forwardedHeadersAreReadOnlyFromATrustedPeerWhenProxiesAreSet() {
            PanelRateLimiter limiter = new PanelRateLimiter(properties(true, "", "10.0.0.0/8, fd00::/8"));
            MockHttpServletRequest direct = new MockHttpServletRequest();
            direct.setRemoteAddr("203.0.113.5");
            direct.addHeader("CF-Connecting-IP", "9.9.9.9");
            direct.addHeader("X-Forwarded-For", "8.8.8.8");
            assertThat(limiter.clientIp(direct)).isEqualTo("203.0.113.5");

            MockHttpServletRequest viaIngress = new MockHttpServletRequest();
            viaIngress.setRemoteAddr("10.42.0.7");
            viaIngress.addHeader("CF-Connecting-IP", "9.9.9.9");
            assertThat(limiter.clientIp(viaIngress)).isEqualTo("9.9.9.9");

            MockHttpServletRequest viaV6 = new MockHttpServletRequest();
            viaV6.setRemoteAddr("fd12::3");
            viaV6.addHeader("X-Forwarded-For", "7.7.7.7");
            assertThat(limiter.clientIp(viaV6)).isEqualTo("7.7.7.7");
        }

        @Test
        void anUnreadableProxySettingStopsTheBoot() {
            assertThatThrownBy(() -> properties(true, "", "10.0.0.0/33")).isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> properties(true, "", "ingress.local")).isInstanceOf(IllegalArgumentException.class);
        }
    }

    // ----------------------------------------------------- password login ---

    @Nested
    class PasswordLogin {
        private final PanelRepository repository = mock(PanelRepository.class);
        private final PanelDevices devices = mock(PanelDevices.class);
        private final AuthenticationManager authentication = mock(AuthenticationManager.class);

        private PanelRateLimiter limiter;

        @BeforeEach
        void refuseEveryPassword() {
            when(authentication.authenticate(any())).thenThrow(new BadCredentialsException("no"));
        }

        private PanelSessionService service(PanelProperties properties, boolean passwordLoginAllowed) {
            limiter = new PanelRateLimiter(properties);
            when(devices.requireActive(anyString(), anyString())).thenReturn(device("inst", passwordLoginAllowed));
            return new PanelSessionService(repository, properties, devices, mock(PanelAccessPolicy.class),
                    mock(PanelTokenService.class), limiter, inlineTx(), mock(UserRepository.class), authentication);
        }

        private String login(PanelSessionService service, String username) {
            return code(() -> service.loginPassword(new LoginPasswordRequest("dev-1", "secret", username, "pw")));
        }

        @Test
        void aPanelWithPasswordsOffIsAnsweredBeforeTheLimiterStoresAnything() {
            PanelSessionService service = service(properties(), false);
            assertThat(login(service, "x".repeat(7_900))).isEqualTo("PASSWORD_DISABLED");
            assertThat(limiter.trackedKeys("login_password")).isZero();
            assertThat(limiter.trackedKeys("login_password_device")).isZero();
        }

        @Test
        void anOversizedOrControlCharacterUsernameIsRefusedBeforeTheLimiterAndTheDatabase() {
            PanelSessionService service = service(properties(), true);
            assertThat(login(service, "x".repeat(7_900))).isEqualTo("BAD_CREDENTIALS");
            assertThat(login(service, "teacher\u0000")).isEqualTo("BAD_CREDENTIALS");
            assertThat(login(service, "  ")).isEqualTo("BAD_CREDENTIALS");
            assertThat(limiter.trackedKeys("login_password")).isZero();
            verify(authentication, never()).authenticate(any());
        }

        @Test
        void theLimitIsPerDeviceAndUsernameWhateverItsCase() {
            PanelSessionService service = service(properties(), true);
            for (String name : new String[] { "teacher", "Teacher", "TEACHER", "teacher", "tEacher" }) {
                assertThat(login(service, name)).isEqualTo("BAD_CREDENTIALS");
            }
            assertThat(login(service, "TeAcHeR")).isEqualTo("RATE_LIMITED");
            assertThat(limiter.trackedKeys("login_password")).isEqualTo(1);
            assertThat(login(service, "someone-else")).isEqualTo("BAD_CREDENTIALS");
        }

        @Test
        void oneDeviceGetsAFixedNumberOfAttemptsAcrossUsernames() {
            PanelSessionService service = service(properties(), true);
            for (int i = 0; i < PanelRateLimiter.LOGIN_PASSWORD_PER_DEVICE; i++) {
                assertThat(login(service, "user-" + i)).isEqualTo("BAD_CREDENTIALS");
            }
            assertThat(login(service, "user-new")).isEqualTo("RATE_LIMITED");
        }

        @Test
        void anInstituteOutsideTheAllowListCannotSignIn() {
            PanelSessionService service = service(properties(true, "pilot", ""), true);
            assertThat(login(service, "teacher")).isEqualTo("PANEL_DISABLED");
            verify(authentication, never()).authenticate(any());
        }
    }

    // ----------------------------------------------------- session starts ---

    @Nested
    class SessionStarts {
        @Test
        void oneUserStartsAFixedNumberOfSessionsAnHour() {
            PanelRepository repository = mock(PanelRepository.class);
            when(repository.insertSession(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(),
                    any(), any(), org.mockito.ArgumentMatchers.anyInt())).thenReturn(1);
            PanelSessionService service = new PanelSessionService(repository, properties(), mock(PanelDevices.class),
                    mock(PanelAccessPolicy.class), mock(PanelTokenService.class), new PanelRateLimiter(properties()),
                    inlineTx(), mock(UserRepository.class), mock(AuthenticationManager.class));
            DeviceRow device = device("inst", false);
            for (int i = 0; i < PanelRateLimiter.SESSION_STARTS_PER_USER_PER_HOUR; i++) {
                service.startSessionInTx(device, "u1", "QR", null, "remote-" + i);
            }
            assertThat(code(() -> service.startSessionInTx(device, "u1", "QR", null, "remote-x")))
                    .isEqualTo("RATE_LIMITED");
            service.startSessionInTx(device, "u2", "QR", null, "remote-y");
        }

        @Test
        void theHourlyLimitIsASetting() {
            PanelRepository repository = mock(PanelRepository.class);
            when(repository.insertSession(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(),
                    any(), any(), org.mockito.ArgumentMatchers.anyInt())).thenReturn(1);
            PanelProperties three = new PanelProperties(true, true, 1, 4, false, 9999, 30, 4, 1,
                    "https://classroom.vacademy.io", "", "", 3);
            PanelSessionService service = new PanelSessionService(repository, three, mock(PanelDevices.class),
                    mock(PanelAccessPolicy.class), mock(PanelTokenService.class), new PanelRateLimiter(three),
                    inlineTx(), mock(UserRepository.class), mock(AuthenticationManager.class));
            DeviceRow device = device("inst", false);
            for (int i = 0; i < 3; i++) {
                service.startSessionInTx(device, "u1", "QR", null, "remote-" + i);
            }
            assertThat(code(() -> service.startSessionInTx(device, "u1", "QR", null, "remote-x")))
                    .isEqualTo("RATE_LIMITED");
            assertThat(properties().getSessionStartsPerUserPerHour())
                    .isEqualTo(PanelRateLimiter.SESSION_STARTS_PER_USER_PER_HOUR);
        }
    }

    // --------------------------------------------------------- allow list ---

    @Nested
    class AllowedInstitutes {
        private final PanelRepository repository = mock(PanelRepository.class);
        private final PanelAccessPolicy policy = mock(PanelAccessPolicy.class);
        private final PanelInstituteDirectory directory = mock(PanelInstituteDirectory.class);

        private PanelChallengeService challenges(PanelProperties properties) {
            return new PanelChallengeService(repository, properties, mock(PanelDevices.class), policy,
                    mock(PanelSessionService.class), mock(PanelTokenService.class), new PanelRateLimiter(properties),
                    mock(PanelMaintenance.class), directory, inlineTx(), mock(UserRepository.class));
        }

        private void openChallengeAt(String institute) {
            Timestamp now = new Timestamp(System.currentTimeMillis());
            Timestamp later = new Timestamp(now.getTime() + 60_000);
            when(repository.findChallengeByTokenHash(anyString())).thenReturn(Optional.of(new ChallengeRow("ch-1",
                    "dev-1", institute, "SIGN_IN", null, 42, "42,17,88", "SCANNED", null, null, null, null, later,
                    now, now)));
            when(repository.findDevice("dev-1")).thenReturn(Optional.of(device(institute, false)));
        }

        @Test
        void emptyMeansEveryInstitute() {
            properties(true, "", "").requireInstituteAllowed("any");
            properties(true, " pilot , other ", "").requireInstituteAllowed("other");
            assertThat(code(() -> properties(true, "pilot", "").requireInstituteAllowed("other")))
                    .isEqualTo("PANEL_DISABLED");
            assertThat(code(() -> properties(true, "pilot", "").requireInstituteAllowed(null)))
                    .isEqualTo("PANEL_DISABLED");
        }

        @Test
        void approveAndScanAreRefusedOutsideTheList() {
            openChallengeAt("other");
            PanelChallengeService service = challenges(properties(true, "pilot", ""));
            assertThat(code(() -> service.approve(principal("u1"), new ChallengeApproveRequest("t", null, 42, null),
                    "ip"))).isEqualTo("PANEL_DISABLED");
            assertThat(code(() -> service.describe(principal("u1"), new ChallengeDescribeRequest("t", null))))
                    .isEqualTo("PANEL_DISABLED");
            verifyNoInteractions(policy);
            verify(repository, never()).approveChallenge(anyString(), anyString(), anyString(), anyString());
            verify(repository, never()).markScanned(anyString(), anyString(), org.mockito.ArgumentMatchers.anyInt(),
                    org.mockito.ArgumentMatchers.anyInt());
        }

        @Test
        void aPanelOutsideTheListGetsNoSignInCode() {
            PanelProperties restricted = properties(true, "pilot", "");
            PanelDevices devices = mock(PanelDevices.class);
            when(devices.requireActive(anyString(), anyString())).thenReturn(device("other", false));
            PanelChallengeService service = new PanelChallengeService(repository, restricted, devices, policy,
                    mock(PanelSessionService.class), mock(PanelTokenService.class), new PanelRateLimiter(restricted),
                    mock(PanelMaintenance.class), directory, inlineTx(), mock(UserRepository.class));
            assertThat(code(() -> service.create(new ChallengeRequest("dev-1", "secret", "SIGN_IN", null))))
                    .isEqualTo("PANEL_DISABLED");
            verifyNoInteractions(repository, directory);
        }

        @Test
        void approveGoesOnToTheStaffCheckInsideTheList() {
            openChallengeAt("pilot");
            when(repository.approveChallenge(anyString(), anyString(), anyString(), anyString())).thenReturn(0);
            PanelChallengeService service = challenges(properties(true, "pilot", ""));
            code(() -> service.approve(principal("u1"), new ChallengeApproveRequest("t", null, 42, null), "ip"));
            verify(policy).check("u1", "pilot", "Alpha");
        }

        @Test
        void claimIsRefusedOutsideTheListBeforeAnyLookup() {
            PanelProperties restricted = properties(true, "pilot", "");
            PanelPairingService pairing = new PanelPairingService(repository, restricted,
                    new PanelRateLimiter(restricted), mock(PanelMaintenance.class), mock(PanelDevices.class),
                    inlineTx(), directory, mock(InstituteOAuthClientAccessGuard.class));
            assertThat(code(() -> pairing.claim(principal("admin"),
                    new DeviceClaimRequest("K7QF2M9X", 42, "other", null, "Room", false)))).isEqualTo("PANEL_DISABLED");
            verifyNoInteractions(directory, repository);
        }
    }

    // ------------------------------------------------------ request input ---

    @Nested
    class ControlCharacters {
        @Test
        void aDeviceIdWithAControlCharacterNeverReachesTheDatabase() {
            PanelRepository repository = mock(PanelRepository.class);
            PanelDevices devices = new PanelDevices(repository);
            assertThat(code(() -> devices.require("dev\u0000", "secret"))).isEqualTo("DEVICE_REVOKED");
            assertThat(code(() -> devices.require("dev\n1", "secret"))).isEqualTo("DEVICE_REVOKED");
            verify(repository, never()).findDevice(any());
        }

        @Test
        void anInstallIdWithAControlCharacterIsABadRequest() {
            PanelRepository repository = mock(PanelRepository.class);
            PanelPairingService pairing = new PanelPairingService(repository, properties(),
                    new PanelRateLimiter(properties()), mock(PanelMaintenance.class), mock(PanelDevices.class),
                    inlineTx(), mock(PanelInstituteDirectory.class), mock(InstituteOAuthClientAccessGuard.class));
            assertThat(code(() -> pairing.start(new PairStartRequest("install\u0000", Map.of()), "1.1.1.1")))
                    .isEqualTo("BAD_REQUEST");
            verifyNoInteractions(repository);
        }
    }

    // ----------------------------------------------------- switched off ---

    @Nested
    class SwitchedOff {
        private final PanelPairingService pairing = mock(PanelPairingService.class);
        private final PanelChallengeService challenges = mock(PanelChallengeService.class);
        private final PanelSessionService sessions = mock(PanelSessionService.class);

        private PanelPublicController controller(PanelProperties properties) {
            return new PanelPublicController(pairing, challenges, sessions, properties,
                    new PanelRateLimiter(properties));
        }

        @Test
        void theSwitchIsAnsweredBeforeAnyServiceIsCalled() {
            PanelPublicController controller = controller(properties(false, "", ""));
            MockHttpServletRequest request = new MockHttpServletRequest();
            assertThat(code(() -> controller.pairStart(new PairStartRequest("i", Map.of()), request)))
                    .isEqualTo("PANEL_DISABLED");
            assertThat(code(() -> controller.challenge(new ChallengeRequest("d", "s", "SIGN_IN", null))))
                    .isEqualTo("PANEL_DISABLED");
            assertThat(code(() -> controller.loginPassword(new LoginPasswordRequest("d", "s", "u", "p"))))
                    .isEqualTo("PANEL_DISABLED");
            verifyNoInteractions(pairing, challenges, sessions);
        }

        @Test
        void theFullPairingCapIsAnsweredBeforeStart() {
            when(pairing.pendingCapReached()).thenReturn(true);
            PanelPublicController controller = controller(properties());
            assertThatThrownBy(() -> controller.pairStart(new PairStartRequest("i", Map.of()),
                    new MockHttpServletRequest())).isInstanceOfSatisfying(PanelApiException.class, e -> {
                        assertThat(e.getCode()).isEqualTo("BUSY");
                        assertThat(e.getHttpStatus().value()).isEqualTo(503);
                    });
            verify(pairing, never()).start(any(), any());
        }
    }

    // ------------------------------------------------------------ filter ---

    @Nested
    class EncodedPath {
        private static final String ENCODED = "/auth-service/public/v1/%70anel/sync";
        private static final String DECODED = "/auth-service/public/v1/panel/sync";

        /** What the container hands the filter for a percent-encoded request. */
        private MockHttpServletRequest encoded(boolean asPathInfo) {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", ENCODED);
            if (asPathInfo) {
                request.setServletPath("");
                request.setPathInfo(DECODED);
            } else {
                request.setServletPath(DECODED);
            }
            return request;
        }

        @Test
        void anEncodedSpellingStillNeedsAPermit() throws Exception {
            PanelConcurrencyFilter filter = new PanelConcurrencyFilter(
                    new PanelProperties(true, true, 1, 0, false, 9999, 30, 4, 1, "https://x", "", ""));
            for (boolean asPathInfo : new boolean[] { false, true }) {
                FilterChain chain = mock(FilterChain.class);
                MockHttpServletResponse response = new MockHttpServletResponse();
                filter.doFilter(encoded(asPathInfo), response, chain);
                assertThat(response.getStatus()).isEqualTo(429);
                verify(chain, never()).doFilter(any(), any());
            }
        }

        @Test
        void anEncodedSpellingStillHasTheBodyLimit() throws Exception {
            PanelConcurrencyFilter filter = new PanelConcurrencyFilter(properties());
            MockHttpServletRequest request = encoded(false);
            request.setContent(new byte[9000]);
            FilterChain chain = mock(FilterChain.class);
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(request, response, chain);
            assertThat(response.getStatus()).isEqualTo(400);
            verify(chain, never()).doFilter(any(), any());
        }
    }

    // --------------------------------------------------- over real MVC ---

    @Nested
    class OverMvc {
        private final PanelPairingService pairing = mock(PanelPairingService.class);
        private final PanelChallengeService challenges = mock(PanelChallengeService.class);
        private final PanelSessionService sessions = mock(PanelSessionService.class);
        private final PanelAdminService admin = mock(PanelAdminService.class);
        private final CustomUserDetails user = principal("u1");
        private MockMvc mvc;

        @BeforeEach
        void setUp() {
            PanelRateLimiter limiter = new PanelRateLimiter(properties());
            mvc = MockMvcBuilders
                    .standaloneSetup(new PanelPublicController(pairing, challenges, sessions, properties(), limiter),
                            new PanelTeacherController(pairing, challenges, sessions, limiter),
                            new PanelAdminController(admin, pairing))
                    .setControllerAdvice(new PanelExceptionAdvice())
                    .addMappedInterceptors(new String[] { PanelBearerGuard.BEARER_PATHS }, new PanelBearerGuard())
                    .build();
            when(pairing.poll(any())).thenReturn(PairPollResponse.of("EXPIRED", 3000));
            when(challenges.approve(any(), any(), any())).thenReturn(new ChallengeDeniedResponse(true));
        }

        private String token(boolean panel) {
            Map<String, Object> claims = new java.util.HashMap<>();
            claims.put("user", "u1");
            if (panel) {
                claims.put("pnl", "session-1");
            }
            long now = System.currentTimeMillis();
            return "Bearer " + Jwts.builder().setClaims(claims).setSubject("teacher").setIssuedAt(new Date(now))
                    .setExpiration(new Date(now + 900_000))
                    .signWith(Keys.hmacShaKeyFor(Decoders.BASE64.decode(JwtService.secretKey)), SignatureAlgorithm.HS256)
                    .compact();
        }

        private MockHttpServletRequestBuilder bearer(MockHttpServletRequestBuilder builder, boolean panelToken) {
            return builder.header(HttpHeaders.AUTHORIZATION, token(panelToken)).requestAttr("user", user)
                    .contentType(MediaType.APPLICATION_JSON);
        }

        @Test
        void aPanelSessionTokenIsRefusedOnEveryStaffEndpoint() throws Exception {
            String approve = "{\"t\":\"x\",\"match_code\":42}";
            mvc.perform(bearer(post("/auth-service/v1/panel/challenge/approve"), true).content(approve))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
            mvc.perform(bearer(post("/auth-service/v1/panel/challenge/describe"), true).content("{\"t\":\"x\"}"))
                    .andExpect(status().isForbidden());
            mvc.perform(bearer(post("/auth-service/v1/panel/pair/preview"), true).content("{\"code\":\"x\"}"))
                    .andExpect(status().isForbidden());
            mvc.perform(bearer(post("/auth-service/v1/panel/admin/devices/claim"), true).content("{}"))
                    .andExpect(status().isForbidden());
            mvc.perform(bearer(get("/auth-service/v1/panel/admin/rooms").param("institute_id", "inst"), true))
                    .andExpect(status().isForbidden());
            mvc.perform(bearer(post(URI.create("/auth-service/v1/%70anel/challenge/approve")), true).content(approve))
                    .andExpect(status().isForbidden());
            verifyNoInteractions(challenges, pairing, admin);

            mvc.perform(bearer(post("/auth-service/v1/panel/challenge/approve"), false).content(approve))
                    .andExpect(status().isOk());
            verify(challenges).approve(any(), any(), any());
        }

        @Test
        void aWrongBodyTypeAcceptOrMethodIsAClientError() throws Exception {
            mvc.perform(post("/auth-service/public/v1/panel/pair/poll").contentType(MediaType.TEXT_PLAIN)
                    .content("pair_secret=x")).andExpect(status().isUnsupportedMediaType())
                    .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
            mvc.perform(post("/auth-service/public/v1/panel/pair/poll")
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED).content("pair_secret=x"))
                    .andExpect(status().isUnsupportedMediaType());
            mvc.perform(post("/auth-service/public/v1/panel/pair/poll").contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.TEXT_PLAIN).content("{\"pair_secret\":\"x\"}"))
                    .andExpect(status().isNotAcceptable());
            mvc.perform(get("/auth-service/public/v1/panel/pair/poll")).andExpect(status().isMethodNotAllowed());
        }
    }
}
