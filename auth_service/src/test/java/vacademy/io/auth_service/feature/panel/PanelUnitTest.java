package vacademy.io.auth_service.feature.panel;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.auth_service.feature.demo.service.TrialAccessGuard;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.panel.controller.PanelExceptionAdvice;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.*;
import vacademy.io.auth_service.feature.panel.filter.PanelConcurrencyFilter;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.service.PanelAccessPolicy;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelInstituteDirectory;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelRateLimiter;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;
import vacademy.io.auth_service.feature.panel.service.PanelTokenService;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserPermissionRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Rules that need no database. Real-SQL behaviour is in PanelDatabaseIntegrationTest. */
class PanelUnitTest {

    private static PanelProperties properties(int maxConcurrent) {
        return new PanelProperties(true, true, 1, maxConcurrent, false, 9999, 30, 4, 1,
                "https://classroom.vacademy.io", "", "");
    }

    private static UserRole role(String institute, String name, String status) {
        Role role = new Role();
        role.setName(name);
        role.setAuthorities(new HashSet<>());
        UserRole userRole = new UserRole();
        userRole.setRole(role);
        userRole.setInstituteId(institute);
        userRole.setStatus(status);
        return userRole;
    }

    @Nested
    class AccessPolicy {
        private final UserRepository users = mock(UserRepository.class);
        private final UserRoleRepository roles = mock(UserRoleRepository.class);
        private final TrialAccessGuard trial = mock(TrialAccessGuard.class);
        private final PanelAccessPolicy policy = new PanelAccessPolicy(users, roles, trial);

        private void given(boolean root, UserRole... held) {
            User user = new User();
            user.setId("u1");
            user.setRootUser(root);
            when(users.findById("u1")).thenReturn(Optional.of(user));
            when(roles.findByUser(user)).thenReturn(List.of(held));
        }

        private void assertRefused() {
            assertThatThrownBy(() -> policy.check("u1", "inst", "Alpha"))
                    .isInstanceOfSatisfying(PanelApiException.class, e -> {
                        assertThat(e.getCode()).isEqualTo("NOT_STAFF");
                        assertThat(e.getHttpStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                        assertThat(e.getExtras()).containsEntry("institute_name", "Alpha");
                    });
        }

        @Test
        void teacherCustomRoleAndInvitedStaffPass() {
            for (UserRole held : List.of(role("inst", "TEACHER", "ACTIVE"), role("inst", "Faculty", "ACTIVE"),
                    role("inst", "TEACHER", "INVITED"))) {
                given(false, held);
                assertThatCode(() -> policy.check("u1", "inst", "Alpha")).doesNotThrowAnyException();
            }
        }

        @Test
        void learnerRolesNeedAdminOrCounsellorBesideThem() {
            given(false, role("inst", "STUDENT", "ACTIVE"), role("inst", "TEACHER", "ACTIVE"));
            assertRefused();
            given(false, role("inst", "PARENT", "ACTIVE"));
            assertRefused();
            given(false, role("inst", "guardian", "ACTIVE"), role("inst", "Faculty", "ACTIVE"));
            assertRefused();
            given(false, role("inst", "STUDENT", "ACTIVE"), role("inst", "ADMIN", "ACTIVE"));
            assertThatCode(() -> policy.check("u1", "inst", "Alpha")).doesNotThrowAnyException();
            given(false, role("inst", "STUDENT", "ACTIVE"), role("inst", "COUNSELLOR", "ACTIVE"));
            assertThatCode(() -> policy.check("u1", "inst", "Alpha")).doesNotThrowAnyException();
        }

        @Test
        void rootFlagIsIgnoredAndOtherInstitutesDoNotCount() {
            given(true);
            assertRefused();
            given(true, role("other", "ADMIN", "ACTIVE"));
            assertRefused();
        }

        @Test
        void removedRolesDoNotCount() {
            for (String status : List.of("DISABLED", "DELETED", "INACTIVE")) {
                given(false, role("inst", "TEACHER", status));
                assertRefused();
            }
            given(false, role("inst", "STUDENT", "DELETED"), role("inst", "TEACHER", "ACTIVE"));
            assertThatCode(() -> policy.check("u1", "inst", "Alpha")).doesNotThrowAnyException();
        }

        @Test
        void unknownUserIsRefusedAndTrialIsCheckedOnlyForStaff() {
            when(users.findById("u1")).thenReturn(Optional.empty());
            assertRefused();
            verify(trial, never()).assertNotExpired(any());
            given(false, role("inst", "TEACHER", "ACTIVE"));
            policy.check("u1", "inst", "Alpha");
            verify(trial).assertNotExpired("inst");
        }

        @Test
        void aLapsedTrialRefuses() {
            given(false, role("inst", "TEACHER", "ACTIVE"));
            org.mockito.Mockito.doThrow(new VacademyException(HttpStatus.FORBIDDEN, "ended"))
                    .when(trial).assertNotExpired("inst");
            assertThatThrownBy(() -> policy.check("u1", "inst", "Alpha")).isInstanceOf(VacademyException.class);
        }
    }

    @Nested
    class Secrets {
        @Test
        void codesAreEightCrockfordCharacters() {
            Set<String> seen = new HashSet<>();
            for (int i = 0; i < 2000; i++) {
                String code = PanelSecrets.code();
                assertThat(code).matches("[0-9A-HJKMNP-TV-Z]{8}");
                seen.add(code);
            }
            assertThat(seen.size()).isGreaterThan(1990);
        }

        @Test
        void tokensHaveTheContractLengths() {
            assertThat(PanelSecrets.token(16)).hasSize(22).matches("[A-Za-z0-9_-]+");
            assertThat(PanelSecrets.token(32)).hasSize(43);
        }

        @Test
        void typedCodesAreNormalised() {
            assertThat(PanelSecrets.normaliseCode("k7qf-2m9x")).isEqualTo("K7QF2M9X");
            assertThat(PanelSecrets.normaliseCode("O1IL 0000")).isEqualTo("01110000");
            assertThat(PanelSecrets.normaliseCode("SHORT")).isNull();
            assertThat(PanelSecrets.normaliseCode(null)).isNull();
            assertThat(PanelSecrets.normaliseCode("X".repeat(40))).isNull();
        }

        @Test
        void matchNumbersAreThreeDistinctTwoDigitValuesIncludingTheRightOne() {
            for (int i = 0; i < 500; i++) {
                PanelSecrets.MatchNumbers numbers = PanelSecrets.matchNumbers();
                List<Integer> options = PanelSecrets.parseOptions(numbers.options());
                assertThat(options).hasSize(3).doesNotHaveDuplicates().contains(numbers.matchCode());
                assertThat(options).allMatch(n -> n >= 10 && n <= 99);
                assertThat(numbers.options().length()).isLessThanOrEqualTo(16);
            }
        }

        @Test
        void matchesComparesAgainstTheHashAndRefusesOversizedInput() {
            String secret = PanelSecrets.token(32);
            String hash = PanelSecrets.sha256Hex(secret);
            assertThat(hash).hasSize(64);
            assertThat(PanelSecrets.matches(secret, hash)).isTrue();
            assertThat(PanelSecrets.matches(secret + "x", hash)).isFalse();
            assertThat(PanelSecrets.matches(null, hash)).isFalse();
            assertThat(PanelSecrets.matches(secret, null)).isFalse();
            assertThat(PanelSecrets.matches("x".repeat(65), hash)).isFalse();
        }
    }

    @Nested
    class ApproveBase {
        private static final String DEFAULT = "https://classroom.vacademy.io";

        @ParameterizedTest
        @ValueSource(strings = { "", "   ", "http://school.example", "https://1.2.3.4", "1.2.3.4",
                "https://[::1]", "https://localhost", "localhost", "https://app.localhost", "vacademy.io",
                "https://vacademy.io", "dash.vacademy.io", "https://dash.vacademy.io/login", "https://DASH.Vacademy.IO",
                "https://evalezy.vacademy.io.", "https://0x7f.0.0.1", "ftp://school.example", "not a url",
                "https://intranet" })
        void usesTheDefault(String raw) {
            assertThat(PanelInstituteDirectory.normaliseApproveBase(raw, DEFAULT)).isEqualTo(DEFAULT);
        }

        @Test
        void nullUsesTheDefault() {
            assertThat(PanelInstituteDirectory.normaliseApproveBase(null, DEFAULT)).isEqualTo(DEFAULT);
        }

        @ParameterizedTest
        @CsvSource({ "portal.school.example,https://portal.school.example",
                "https://portal.school.example,https://portal.school.example",
                "https://portal.school.example/some/path?x=1,https://portal.school.example",
                "HTTPS://Portal.School.Example:8443/,https://portal.school.example",
                "https://user@portal.school.example,https://portal.school.example",
                "https://notvacademy.io,https://notvacademy.io" })
        void keepsAnInstituteHostAsSchemeAndHost(String raw, String expected) {
            assertThat(PanelInstituteDirectory.normaliseApproveBase(raw, DEFAULT)).isEqualTo(expected);
        }

        @Test
        void aHostTooLongForTheColumnUsesTheDefault() {
            String longHost = "a".repeat(250) + ".example";
            assertThat(PanelInstituteDirectory.normaliseApproveBase(longHost, DEFAULT)).isEqualTo(DEFAULT);
        }
    }

    @Nested
    class TokenClaims {
        @Test
        @SuppressWarnings("unchecked")
        void fifteenMinutesThisInstituteOnlyWithTheSessionNamed() {
            User user = new User();
            user.setId("u1");
            user.setUsername("teacher");
            user.setFullName("Tara Teacher");
            user.setEmail("t@local.test");
            user.setRootUser(true);
            user.setPreferredLocale("hi");
            UserRoleRepository roles = mock(UserRoleRepository.class);
            when(roles.findByUser(user)).thenReturn(List.of(role("inst-a", "TEACHER", "ACTIVE"),
                    role("inst-b", "ADMIN", "ACTIVE"), role("inst-a", "Faculty", "DISABLED")));
            UserPermissionRepository permissions = mock(UserPermissionRepository.class);
            when(permissions.findByUserId("u1")).thenReturn(List.of());

            String jwt = new PanelTokenService(roles, permissions).mint(user, "inst-a", "session-1");

            Claims claims = Jwts.parserBuilder()
                    .setSigningKey(Keys.hmacShaKeyFor(Decoders.BASE64.decode(JwtService.secretKey)))
                    .build().parseClaimsJws(jwt).getBody();
            assertThat(claims.getExpiration().getTime() - claims.getIssuedAt().getTime()).isEqualTo(900_000);
            assertThat(claims.getSubject()).isEqualTo("teacher");
            assertThat(claims.get("user")).isEqualTo("u1");
            assertThat(claims.get("fullname")).isEqualTo("Tara Teacher");
            assertThat(claims.get("username")).isEqualTo("teacher");
            assertThat(claims.get("email")).isEqualTo("t@local.test");
            assertThat(claims.get("is_root_user")).isEqualTo(true);
            assertThat(claims.get("pnl")).isEqualTo("session-1");
            assertThat(claims.get("locale")).isNotNull();
            Map<String, Map<String, List<String>>> authorities = (Map<String, Map<String, List<String>>>) claims
                    .get("authorities");
            assertThat(authorities.keySet()).containsExactly("inst-a");
            assertThat(authorities.get("inst-a").get("roles")).containsExactly("TEACHER");
        }
    }

    @Nested
    class RateLimiter {
        @Test
        void allowsUpToTheLimitThenAnswersRetryAfter() {
            PanelRateLimiter limiter = new PanelRateLimiter(properties(4));
            for (int i = 0; i < 30; i++) {
                limiter.check("pair_start", "1.1.1.1", 30);
            }
            assertThatThrownBy(() -> limiter.check("pair_start", "1.1.1.1", 30))
                    .isInstanceOfSatisfying(PanelApiException.class, e -> {
                        assertThat(e.getCode()).isEqualTo("RATE_LIMITED");
                        assertThat(e.getHttpStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
                        assertThat((Long) e.getExtras().get("retry_after_ms")).isBetween(1L, 60_000L);
                    });
            limiter.check("pair_start", "2.2.2.2", 30);
            limiter.check("claim", "1.1.1.1", 30);
        }

        @Test
        void clientIpPrefersCloudflareThenTheFirstForwardedEntry() {
            PanelRateLimiter limiter = new PanelRateLimiter(properties(4));
            MockHttpServletRequest request = new MockHttpServletRequest();
            request.setRemoteAddr("10.0.0.9");
            assertThat(limiter.clientIp(request)).isEqualTo("10.0.0.9");
            request.addHeader("X-Forwarded-For", " 7.7.7.7 , 8.8.8.8");
            assertThat(limiter.clientIp(request)).isEqualTo("7.7.7.7");
            request.addHeader("CF-Connecting-IP", "9.9.9.9");
            assertThat(limiter.clientIp(request)).isEqualTo("9.9.9.9");
        }

        @Test
        void aHugeForwardedValueIsCutToTheColumnSize() {
            PanelRateLimiter limiter = new PanelRateLimiter(properties(4));
            MockHttpServletRequest request = new MockHttpServletRequest();
            request.addHeader("CF-Connecting-IP", "x".repeat(500));
            assertThat(limiter.clientIp(request)).hasSize(64);
        }
    }

    @Nested
    class ConcurrencyFilter {
        private MockHttpServletRequest post(String uri) {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", uri);
            request.setServletPath(uri);
            return request;
        }

        @Test
        void answersBusyWithNoChainCallWhenPermitsAreGoneAndFreesThemAfter() throws Exception {
            PanelConcurrencyFilter filter = new PanelConcurrencyFilter(properties(1));
            CountDownLatch inside = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            FilterChain holding = (req, res) -> {
                inside.countDown();
                try {
                    release.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            };
            ExecutorService pool = Executors.newSingleThreadExecutor();
            Future<?> first = pool.submit(() -> {
                filter.doFilter(post(PanelConcurrencyFilter.PUBLIC_PREFIX + "sync"), new MockHttpServletResponse(),
                        holding);
                return null;
            });
            assertThat(inside.await(5, TimeUnit.SECONDS)).isTrue();

            FilterChain mustNotRun = mock(FilterChain.class);
            MockHttpServletResponse busy = new MockHttpServletResponse();
            long start = System.currentTimeMillis();
            filter.doFilter(post(PanelConcurrencyFilter.PUBLIC_PREFIX + "sync"), busy, mustNotRun);
            assertThat(System.currentTimeMillis() - start).isLessThan(1000);
            assertThat(busy.getStatus()).isEqualTo(429);
            assertThat(busy.getContentAsString()).contains("\"code\":\"BUSY\"").contains("\"retry_after_ms\":2000");
            verify(mustNotRun, never()).doFilter(any(), any());

            release.countDown();
            first.get(5, TimeUnit.SECONDS);
            pool.shutdown();

            FilterChain runs = mock(FilterChain.class);
            MockHttpServletResponse ok = new MockHttpServletResponse();
            filter.doFilter(post(PanelConcurrencyFilter.PUBLIC_PREFIX + "sync"), ok, runs);
            verify(runs).doFilter(any(), any());
        }

        @Test
        void otherPathsAndPreflightsNeverTakeAPermit() throws Exception {
            PanelConcurrencyFilter filter = new PanelConcurrencyFilter(properties(0));
            for (String uri : List.of("/auth-service/v1/login-root", "/auth-service/actuator/health",
                    "/auth-service/v1/panel/challenge/approve", "/auth-service/public/v1/other")) {
                FilterChain chain = mock(FilterChain.class);
                filter.doFilter(post(uri), new MockHttpServletResponse(), chain);
                verify(chain).doFilter(any(), any());
            }
            FilterChain chain = mock(FilterChain.class);
            MockHttpServletRequest preflight = new MockHttpServletRequest("OPTIONS",
                    PanelConcurrencyFilter.PUBLIC_PREFIX + "sync");
            filter.doFilter(preflight, new MockHttpServletResponse(), chain);
            verify(chain).doFilter(any(), any());
        }

        @Test
        void anOversizedBodyIsRefusedBeforeItIsRead() throws Exception {
            PanelConcurrencyFilter filter = new PanelConcurrencyFilter(properties(1));
            MockHttpServletRequest request = post(PanelConcurrencyFilter.PUBLIC_PREFIX + "sync");
            request.setContent(new byte[9000]);
            FilterChain chain = mock(FilterChain.class);
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(request, response, chain);
            assertThat(response.getStatus()).isEqualTo(400);
            verify(chain, never()).doFilter(any(), any());
        }
    }

    @Nested
    class Advice {
        private final PanelExceptionAdvice advice = new PanelExceptionAdvice();

        @Test
        void guardExceptionsBecomeCodes() {
            assertThat(code(advice.vacademy(new VacademyException(HttpStatus.FORBIDDEN, "no")))).isEqualTo("FORBIDDEN");
            assertThat(code(advice.vacademy(new VacademyException(HttpStatus.UNAUTHORIZED, "no"))))
                    .isEqualTo("UNAUTHORIZED");
            assertThat(code(advice.vacademy(new VacademyException(HttpStatus.BAD_REQUEST, "no"))))
                    .isEqualTo("BAD_REQUEST");
            ResponseEntity<Map<String, Object>> plain = advice.vacademy(new VacademyException("boom"));
            assertThat(code(plain)).isEqualTo("ERROR");
            assertThat(plain.getStatusCode().value()).isEqualTo(510);
        }

        @Test
        void panelExceptionsCarryTheirExtras() {
            ResponseEntity<Map<String, Object>> response = advice.panel(PanelApiException.sessionEnded("IDLE"));
            assertThat(response.getStatusCode().value()).isEqualTo(401);
            assertThat(response.getBody()).containsEntry("code", "SESSION_ENDED").containsEntry("reason", "IDLE");
        }

        @Test
        void anUnexpectedFailureDoesNotEchoItsMessage() {
            ResponseEntity<Map<String, Object>> response = advice.unexpected(new IllegalStateException("db password"));
            assertThat(response.getStatusCode().value()).isEqualTo(500);
            assertThat(response.getBody().toString()).doesNotContain("db password");
        }

        private String code(ResponseEntity<Map<String, Object>> response) {
            return (String) response.getBody().get("code");
        }
    }

    @Nested
    class Logging {
        private static final String MARK = "CREDENTIAL-VALUE";

        @Test
        void requestsCarryingACredentialNeverPrintIt() {
            List<Object> requests = List.of(new PairPollRequest(MARK),
                    new PairConfirmRequest("d", MARK, true),
                    new SyncRequest("d", MARK, "s", MARK, 1, 2, true, null),
                    new ChallengeRequest("d", MARK, "SIGN_IN", MARK),
                    new ChallengePollRequest("d", MARK, "c"),
                    new ChallengeInfoRequest(MARK),
                    new SessionRefreshRequest("d", MARK, MARK),
                    new SessionEndRequest("d", MARK, MARK, "IDLE"),
                    new LoginPasswordRequest("d", MARK, MARK, MARK),
                    new RemoteNavRequest(MARK, 1, 2L),
                    new RemoteTokenRequest(MARK),
                    new PairPreviewRequest(MARK),
                    new DeviceClaimRequest(MARK, 1, "inst", "r", "n", false),
                    new ChallengeDescribeRequest(MARK, MARK),
                    new ChallengeApproveRequest(MARK, MARK, 1, false));
            assertThat(requests).allSatisfy(request -> assertThat(request.toString()).doesNotContain(MARK));
        }

        @Test
        void aRefusalIsAnExpectedClientErrorForTheSharedTracingAndA5xxIsNot() {
            assertThat(PanelApiException.deviceRevoked()).isInstanceOf(ResponseStatusException.class);
            assertThat(PanelApiException.deviceRevoked().getStatusCode().is4xxClientError()).isTrue();
            assertThat(PanelApiException.tryAgain().getStatusCode().is5xxServerError()).isTrue();
            assertThat(PanelApiException.deviceRevoked().getReason()).isEqualTo("This panel is not registered");
        }
    }

    @Nested
    class Directory {
        private final InstituteInternalService institutes = mock(InstituteInternalService.class);
        private final PanelRepository repository = mock(PanelRepository.class);
        private final PanelInstituteDirectory directory = new PanelInstituteDirectory(institutes, properties(4),
                repository);

        private InstituteInfoDTO info() {
            InstituteInfoDTO dto = new InstituteInfoDTO();
            dto.setInstituteName("Alpha");
            dto.setInstituteThemeCode("blue");
            dto.setAdminPortalUrl("portal.school.example");
            dto.setSetting("{\"secret\":\"value\"}");
            return dto;
        }

        @Test
        void aSnapshotHoldsNoSettingAndIsCached() {
            when(institutes.getInstituteByInstituteId("inst")).thenReturn(info());
            PanelInstituteDirectory.Snapshot snapshot = directory.get("inst").orElseThrow();
            assertThat(snapshot.instituteName()).isEqualTo("Alpha");
            assertThat(snapshot.approveBaseUrl()).isEqualTo("https://portal.school.example");
            assertThat(snapshot.toString()).doesNotContain("secret");
            directory.get("inst");
            verify(institutes, org.mockito.Mockito.times(1)).getInstituteByInstituteId("inst");
        }

        @Test
        void aSlowLookupGivesUpAtThreeSecondsAndThenFillsTheCache() throws Exception {
            CountDownLatch release = new CountDownLatch(1);
            when(institutes.getInstituteByInstituteId("slow")).thenAnswer(call -> {
                release.await(10, TimeUnit.SECONDS);
                return info();
            });
            long start = System.currentTimeMillis();
            assertThat(directory.get("slow")).isEmpty();
            assertThat(System.currentTimeMillis() - start).isBetween(2900L, 4000L);
            release.countDown();
            Thread.sleep(200);
            assertThat(directory.get("slow")).isPresent();
            verify(institutes, org.mockito.Mockito.times(1)).getInstituteByInstituteId("slow");
        }

        @Test
        void aFailureOrNoInstituteMeansNoSnapshot() {
            when(institutes.getInstituteByInstituteId("broken")).thenThrow(new RuntimeException("{\"setting\":\"x\"}"));
            assertThat(directory.get("broken")).isEmpty();
            when(institutes.getInstituteByInstituteId("none")).thenReturn(null);
            assertThat(directory.get("none")).isEmpty();
        }

        @Test
        void theBrandingRefreshNeverWaitsAndAFullQueueIsDiscarded() throws Exception {
            CountDownLatch release = new CountDownLatch(1);
            when(institutes.getInstituteByInstituteId("slow")).thenAnswer(call -> {
                release.await(10, TimeUnit.SECONDS);
                return info();
            });
            long start = System.currentTimeMillis();
            for (int i = 0; i < 40; i++) {
                directory.refreshDeviceAsync("device-" + i, "slow");
            }
            assertThat(System.currentTimeMillis() - start).isLessThan(500);
            assertThat(directory.get("after-overflow")).isEmpty();
            release.countDown();
        }
    }
}
