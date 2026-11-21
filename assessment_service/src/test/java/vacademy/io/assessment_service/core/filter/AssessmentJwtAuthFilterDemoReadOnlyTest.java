package vacademy.io.assessment_service.core.filter;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.JwtService;

import java.lang.reflect.Field;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/** assessment_service has its own JWT filter; the read-only demo gate must hold there too. */
class AssessmentJwtAuthFilterDemoReadOnlyTest {

    private static final String SUBJECT = "demo@example.com";
    private static final String BODY = "{\"code\":\"DEMO_READ_ONLY\",\"message\":\"This is a demo. Changes are not saved.\"}";
    private static final String WRITE = "/assessment-service/assessment/add-questions/create/v1/submit";
    private static final String READ_POST = "/assessment-service/assessment/admin/assessment-admin-list-filter";

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private static String token(List<String> roles) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("user", "u-demo");
        claims.put("is_root_user", true);
        claims.put("authorities", Map.of("inst-demo", Map.of("roles", roles, "permissions", List.of())));
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .setClaims(claims)
                .setSubject(SUBJECT)
                .setIssuedAt(new Date(now))
                .setExpiration(new Date(now + 60_000))
                .signWith(Keys.hmacShaKeyFor(Decoders.BASE64.decode(JwtService.secretKey)), SignatureAlgorithm.HS256)
                .compact();
    }

    private static AssessmentJwtAuthFilter filter(List<String> authorities) throws Exception {
        AssessmentJwtAuthFilter filter = new AssessmentJwtAuthFilter();
        filter.userDetailsService = username -> {
            UserServiceDTO dto = new UserServiceDTO();
            dto.setUsername(SUBJECT);
            dto.setUserId("u-demo");
            dto.setRootUser(true);
            dto.setAuthorities(authorities);
            return new CustomUserDetails(dto);
        };
        Field jwt = AssessmentJwtAuthFilter.class.getDeclaredField("jwtService");
        jwt.setAccessible(true);
        jwt.set(filter, new JwtService());
        return filter;
    }

    private record Outcome(MockHttpServletResponse response, MockFilterChain chain) {
    }

    private static Outcome call(String method, String uri, List<String> roles, String clientId) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.addHeader("Authorization", "Bearer " + token(roles));
        if (clientId != null) {
            request.addHeader("clientId", clientId);
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        // The header's institute decides what the lookup returns: roles only for inst-demo.
        filter("inst-demo".equals(clientId) ? roles : List.of()).doFilterInternal(request, response, chain);
        return new Outcome(response, chain);
    }

    private static void assertRefused(Outcome outcome) throws Exception {
        assertNull(outcome.chain().getRequest(), "the request must not reach the controller");
        assertEquals(403, outcome.response().getStatus());
        assertEquals("application/json", outcome.response().getContentType().split(";")[0]);
        assertEquals(BODY, outcome.response().getContentAsString());
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void demoUserWriteIsRefused() throws Exception {
        assertRefused(call("POST", WRITE, List.of("ADMIN", "DEMO_READ_ONLY"), "inst-demo"));
        assertRefused(call("DELETE", WRITE, List.of("ADMIN", "DEMO_READ_ONLY"), "inst-demo"));
    }

    @Test
    void demoUserWriteIsRefusedWithAnotherOrNoInstituteHeader() throws Exception {
        assertRefused(call("POST", WRITE, List.of("ADMIN", "DEMO_READ_ONLY"), "inst-other"));
        assertRefused(call("PUT", WRITE, List.of("ADMIN", "DEMO_READ_ONLY"), null));
    }

    @Test
    void demoUserBlockedGetIsRefused() throws Exception {
        assertRefused(call("GET", "/assessment-service/assessment/export/pdf/ai-student-report",
                List.of("ADMIN", "DEMO_READ_ONLY"), "inst-demo"));
    }

    @Test
    void demoUserReadsAreServed() throws Exception {
        Outcome get = call("GET", WRITE, List.of("ADMIN", "DEMO_READ_ONLY"), "inst-demo");
        assertNotNull(get.chain().getRequest());
        assertEquals(200, get.response().getStatus());
        SecurityContextHolder.clearContext();
        Outcome list = call("POST", READ_POST, List.of("ADMIN", "DEMO_READ_ONLY"), "inst-demo");
        assertNotNull(list.chain().getRequest());
        assertNotNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void otherUsersSeeNoChange() throws Exception {
        for (String method : List.of("GET", "POST", "PUT", "PATCH", "DELETE")) {
            Outcome outcome = call(method, WRITE, List.of("ADMIN"), "inst-demo");
            assertNotNull(outcome.chain().getRequest(), method);
            assertEquals(200, outcome.response().getStatus());
            assertEquals("", outcome.response().getContentAsString());
            assertNotNull(SecurityContextHolder.getContext().getAuthentication());
            SecurityContextHolder.clearContext();
        }
    }
}
