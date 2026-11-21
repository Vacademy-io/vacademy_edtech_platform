package vacademy.io.common.auth.filter;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import vacademy.io.common.auth.config.JsonAuthEntryPoint;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.testsupport.ServletFakes.FakeRequest;
import vacademy.io.common.testsupport.ServletFakes.FakeResponse;
import vacademy.io.common.testsupport.ServletFakes.RecordingChain;

import java.lang.reflect.Field;
import java.util.Date;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JwtAuthFilterTokenInvalidTest {

    private static final String OTHER_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    private static final String SUBJECT = "someone@example.com";
    private static final String PATH = "/admin-core-service/v1/something";

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private static String token(String key, long expiresInMs) {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .setClaims(Map.of("user", "u-1"))
                .setSubject(SUBJECT)
                .setIssuedAt(new Date(now))
                .setExpiration(new Date(now + expiresInMs))
                .signWith(Keys.hmacShaKeyFor(Decoders.BASE64.decode(key)), SignatureAlgorithm.HS256)
                .compact();
    }

    private static JwtAuthFilter filter(UserDetailsService users) throws Exception {
        JwtAuthFilter filter = new JwtAuthFilter();
        filter.userDetailsService = users;
        Field jwt = JwtAuthFilter.class.getDeclaredField("jwtService");
        jwt.setAccessible(true);
        jwt.set(filter, new JwtService());
        return filter;
    }

    private static UserDetailsService knownUser() {
        return username -> {
            CustomUserDetails details = new CustomUserDetails();
            details.setUsername(SUBJECT);
            return details;
        };
    }

    private static FakeRequest bearer(String token) {
        return new FakeRequest("GET", PATH).header("Authorization", "Bearer " + token).header("clientId", "inst-1");
    }

    /** What a refused request gets back, written by the shared entry point. */
    private static FakeResponse refuse(FakeRequest request) throws Exception {
        FakeResponse response = new FakeResponse();
        HttpServletResponse out = response.proxy();
        new JsonAuthEntryPoint().commence(request.proxy(), out, null);
        out.getWriter().flush();
        return response;
    }

    @Test
    void tokenSignedWithAnotherKeyIsRecordedAsTokenInvalid() throws Exception {
        FakeRequest request = bearer(token(OTHER_KEY, 60_000));
        RecordingChain chain = new RecordingChain();

        filter(knownUser()).doFilterInternal(request.proxy(), new FakeResponse().proxy(), chain);

        assertTrue(chain.called, "permitAll routes must still be served");
        assertNull(SecurityContextHolder.getContext().getAuthentication());
        assertEquals(JwtAuthFilter.TOKEN_INVALID, request.attributes.get(JwtAuthFilter.AUTH_FAILURE_REASON));

        FakeResponse response = refuse(request);
        assertEquals(403, response.status);
        assertTrue(response.bodyText().contains("\"error\":\"TOKEN_INVALID\""), response.bodyText());
    }

    @Test
    void malformedBearerIsRecordedAsTokenInvalid() throws Exception {
        FakeRequest request = bearer("undefined");
        RecordingChain chain = new RecordingChain();

        filter(knownUser()).doFilterInternal(request.proxy(), new FakeResponse().proxy(), chain);

        assertTrue(chain.called);
        assertEquals(JwtAuthFilter.TOKEN_INVALID, request.attributes.get(JwtAuthFilter.AUTH_FAILURE_REASON));
        assertEquals(403, refuse(request).status);
    }

    @Test
    void validTokenAuthenticatesAndRecordsNoReason() throws Exception {
        FakeRequest request = bearer(token(JwtService.secretKey, 60_000));
        RecordingChain chain = new RecordingChain();

        filter(knownUser()).doFilterInternal(request.proxy(), new FakeResponse().proxy(), chain);

        assertTrue(chain.called);
        assertNotNull(SecurityContextHolder.getContext().getAuthentication());
        assertNull(request.attributes.get(JwtAuthFilter.AUTH_FAILURE_REASON));
    }

    @Test
    void expiredTokenIsStillAnExpiredTokenError() throws Exception {
        FakeRequest request = bearer(token(JwtService.secretKey, -60_000));

        VacademyException thrown = assertThrows(VacademyException.class, () ->
                filter(knownUser()).doFilterInternal(request.proxy(), new FakeResponse().proxy(), new RecordingChain()));
        assertEquals("Expired Token", thrown.getMessage());
        assertNull(request.attributes.get(JwtAuthFilter.AUTH_FAILURE_REASON));
    }

    @Test
    void unknownUserKeepsItsOwnReason() throws Exception {
        FakeRequest request = bearer(token(JwtService.secretKey, 60_000));
        UserDetailsService none = username -> {
            throw new UsernameNotFoundException("no such user");
        };

        filter(none).doFilterInternal(request.proxy(), new FakeResponse().proxy(), new RecordingChain());

        FakeResponse response = refuse(request);
        assertEquals(403, response.status);
        assertTrue(response.bodyText().contains("\"error\":\"USER_NOT_RESOLVED\""), response.bodyText());
    }

    @Test
    void otherRefusalsKeepTheirCodes() throws Exception {
        // No credentials.
        FakeRequest anonymous = new FakeRequest("GET", PATH);
        FakeResponse noBearer = refuse(anonymous);
        assertEquals(403, noBearer.status);
        assertTrue(noBearer.bodyText().contains("\"error\":\"UNAUTHENTICATED\""), noBearer.bodyText());

        // A valid session refused by a role rule.
        FakeRequest signedIn = bearer(token(JwtService.secretKey, 60_000));
        FakeResponse denied = new FakeResponse();
        HttpServletResponse out = denied.proxy();
        new JsonAuthEntryPoint().handle(signedIn.proxy(), out, null);
        out.getWriter().flush();
        assertEquals(403, denied.status);
        assertTrue(denied.bodyText().contains("\"error\":\"ACCESS_DENIED\""), denied.bodyText());
    }
}
