package vacademy.io.common.auth.filter;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import vacademy.io.common.auth.demo.DemoReadOnlyGate;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.testsupport.ServletFakes.FakeRequest;
import vacademy.io.common.testsupport.ServletFakes.FakeResponse;
import vacademy.io.common.testsupport.ServletFakes.RecordingChain;

import java.lang.reflect.Field;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The read-only demo gate as the shared filter applies it. */
class JwtAuthFilterDemoReadOnlyTest {

    private static final String SUBJECT = "demo@example.com";
    private static final String DEMO_INSTITUTE = "inst-demo";
    private static final String WRITE = "/admin-core-service/v1/audience/lead";
    private static final String READ_POST = "/admin-core-service/v1/audience/leads";
    private static final String BODY = "{\"code\":\"DEMO_READ_ONLY\",\"message\":\"This is a demo. Changes are not saved.\"}";

    private final AtomicInteger lookups = new AtomicInteger();

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    /** A token as auth_service mints it: roles per institute under "authorities". */
    private static String token(boolean root, Map<String, List<String>> rolesByInstitute) {
        Map<String, Object> authorities = new HashMap<>();
        rolesByInstitute.forEach((institute, roles) ->
                authorities.put(institute, Map.of("roles", roles, "permissions", List.of())));
        Map<String, Object> claims = new HashMap<>();
        claims.put("user", "u-demo");
        claims.put("is_root_user", root);
        claims.put("authorities", authorities);
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .setClaims(claims)
                .setSubject(SUBJECT)
                .setIssuedAt(new Date(now))
                .setExpiration(new Date(now + 60_000))
                .signWith(Keys.hmacShaKeyFor(Decoders.BASE64.decode(JwtService.secretKey)), SignatureAlgorithm.HS256)
                .compact();
    }

    /** Resolves the user the way the services do: authorities for the header's institute only. */
    private UserDetailsService users(boolean root, Map<String, List<String>> rolesByInstitute) {
        return username -> {
            lookups.incrementAndGet();
            String institute = username.substring(0, username.indexOf('@'));
            UserServiceDTO dto = new UserServiceDTO();
            dto.setUsername(SUBJECT);
            dto.setUserId("u-demo");
            dto.setRootUser(root);
            dto.setAuthorities(rolesByInstitute.getOrDefault(institute, List.of()));
            return new CustomUserDetails(dto);
        };
    }

    private static JwtAuthFilter filter(UserDetailsService users) throws Exception {
        JwtAuthFilter filter = new JwtAuthFilter();
        filter.userDetailsService = users;
        Field jwt = JwtAuthFilter.class.getDeclaredField("jwtService");
        jwt.setAccessible(true);
        jwt.set(filter, new JwtService());
        return filter;
    }

    private record Outcome(FakeResponse response, RecordingChain chain) {
    }

    private Outcome call(String method, String uri, String clientId, boolean root,
            Map<String, List<String>> roles) throws Exception {
        FakeRequest request = new FakeRequest(method, uri).header("Authorization", "Bearer " + token(root, roles));
        if (clientId != null) {
            request.header("clientId", clientId);
        }
        FakeResponse response = new FakeResponse();
        RecordingChain chain = new RecordingChain();
        filter(users(root, roles)).doFilterInternal(request.proxy(), response.proxy(), chain);
        return new Outcome(response, chain);
    }

    private static void assertRefused(Outcome outcome) {
        assertFalse(outcome.chain().called, "the request must not reach the controller");
        assertEquals(403, outcome.response().status);
        assertEquals("application/json", outcome.response().contentType);
        assertEquals(BODY, outcome.response().bodyText());
        assertEquals(BODY, DemoReadOnlyGate.REFUSAL_BODY);
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    private static void assertServed(Outcome outcome) {
        assertTrue(outcome.chain().called);
        assertEquals(200, outcome.response().status);
        assertEquals("", outcome.response().bodyText());
        assertNotNull(SecurityContextHolder.getContext().getAuthentication());
    }

    private static final Map<String, List<String>> DEMO = Map.of(DEMO_INSTITUTE, List.of("ADMIN", "DEMO_READ_ONLY"));
    private static final Map<String, List<String>> ADMIN = Map.of("inst-1", List.of("ADMIN"));

    @Test
    void demoUserWriteIsRefusedWithTheExactBody() throws Exception {
        for (String method : List.of("POST", "PUT", "PATCH", "DELETE")) {
            assertRefused(call(method, WRITE, DEMO_INSTITUTE, false, DEMO));
            SecurityContextHolder.clearContext();
        }
    }

    @Test
    void demoUserReadsAreServed() throws Exception {
        assertServed(call("GET", WRITE, DEMO_INSTITUTE, false, DEMO));
        SecurityContextHolder.clearContext();
        assertServed(call("POST", READ_POST, DEMO_INSTITUTE, false, DEMO));
        SecurityContextHolder.clearContext();
        assertServed(call("POST", "/auth-service/v1/refresh-token", DEMO_INSTITUTE, false, DEMO));
    }

    @Test
    void demoUserBlockedGetIsRefused() throws Exception {
        assertRefused(call("GET", "/admin-core-service/admin/learner-portal/v1/access", DEMO_INSTITUTE, false, DEMO));
    }

    @Test
    void rootDemoUserIsRefusedToo() throws Exception {
        assertRefused(call("POST", WRITE, DEMO_INSTITUTE, true, DEMO));
    }

    @Test
    void anotherInstituteOrNoInstituteInTheHeaderDoesNotSwitchTheGateOff() throws Exception {
        assertRefused(call("POST", WRITE, "inst-other", false, DEMO));
        SecurityContextHolder.clearContext();
        assertRefused(call("DELETE", WRITE, null, true, DEMO));
    }

    @Test
    void demoRoleOnOneInstituteStillGatesAUserWhoIsPlainAdminElsewhere() throws Exception {
        Map<String, List<String>> both = Map.of(DEMO_INSTITUTE, List.of("DEMO_READ_ONLY"), "inst-1", List.of("ADMIN"));
        assertRefused(call("POST", WRITE, "inst-1", false, both));
    }

    @Test
    void usersWithoutTheRoleSeeNoChange() throws Exception {
        for (String method : List.of("GET", "POST", "PUT", "PATCH", "DELETE")) {
            lookups.set(0);
            assertServed(call(method, WRITE, "inst-1", false, ADMIN));
            assertEquals(1, lookups.get(), "the gate must not load the user a second time");
            SecurityContextHolder.clearContext();
        }
        // A GET the demo user may not make is an ordinary GET for everyone else.
        assertServed(call("GET", "/admin-core-service/admin/learner-portal/v1/access", "inst-1", true, ADMIN));
    }

    @Test
    void demoUserIsLoadedOnceToo() throws Exception {
        assertRefused(call("POST", WRITE, DEMO_INSTITUTE, false, DEMO));
        assertEquals(1, lookups.get());
    }

    @Test
    void requestWithoutABearerIsUntouched() throws Exception {
        FakeRequest request = new FakeRequest("POST", "/auth-service/v1/login-root");
        FakeResponse response = new FakeResponse();
        RecordingChain chain = new RecordingChain();
        filter(users(false, DEMO)).doFilterInternal(request.proxy(), response.proxy(), chain);
        assertTrue(chain.called, "sign-in carries no token and must reach the controller");
        assertEquals(200, response.status);
        assertEquals(0, lookups.get());
    }
}
