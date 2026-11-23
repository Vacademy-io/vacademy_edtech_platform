package vacademy.io.common.auth.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import io.jsonwebtoken.security.SignatureException;
import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.entity.User;

import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class JwtServiceTwoKeyTest {

    private static final String CURRENT = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final String PREVIOUS = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    private static final String OTHER = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    private static String tokenSignedWith(String key, String userId, long expiresInMs) {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .setClaims(Map.of("user", userId))
                .setSubject("someone@example.com")
                .setIssuedAt(new Date(now))
                .setExpiration(new Date(now + expiresInMs))
                .signWith(Keys.hmacShaKeyFor(Decoders.BASE64.decode(key)), SignatureAlgorithm.HS256)
                .compact();
    }

    @Test
    void tokenSignedWithCurrentKeyVerifies() {
        Claims claims = JwtService.parseSignedClaims(tokenSignedWith(CURRENT, "u-1", 60_000), CURRENT, null);
        assertEquals("u-1", claims.get("user"));
        assertEquals("someone@example.com", claims.getSubject());
    }

    @Test
    void tokenSignedWithPreviousKeyVerifiesOnlyWhenPreviousKeyIsSet() {
        String token = tokenSignedWith(PREVIOUS, "u-2", 60_000);
        assertThrows(SignatureException.class, () -> JwtService.parseSignedClaims(token, CURRENT, null));
        assertEquals("u-2", JwtService.parseSignedClaims(token, CURRENT, PREVIOUS).get("user"));
    }

    @Test
    void tokenSignedWithAnyOtherKeyIsRejected() {
        String token = tokenSignedWith(OTHER, "u-3", 60_000);
        assertThrows(SignatureException.class, () -> JwtService.parseSignedClaims(token, CURRENT, PREVIOUS));
        assertThrows(SignatureException.class, () -> JwtService.parseSignedClaims(token, CURRENT, null));
    }

    @Test
    void expiredTokenSignedWithPreviousKeyStillReportsExpiry() {
        String token = tokenSignedWith(PREVIOUS, "u-4", -60_000);
        assertThrows(ExpiredJwtException.class, () -> JwtService.parseSignedClaims(token, CURRENT, PREVIOUS));
    }

    @Test
    void issuedTokensAreSignedWithTheCurrentKeyOnly() {
        User user = User.builder().id("u-5").username("someone@example.com").build();
        String token = new JwtService().generateToken(user, List.of(), List.of());

        // Without JWT_SECRET_KEY in the test environment the current key is JwtService.secretKey.
        assertEquals("u-5", JwtService.parseSignedClaims(token, JwtService.secretKey, null).get("user"));
        assertEquals("someone@example.com", new JwtService().extractUsername(token));
        // A verifier that only holds some other key (even with this one as "previous" elsewhere) rejects it.
        assertThrows(SignatureException.class, () -> JwtService.parseSignedClaims(token, OTHER, null));
        assertEquals(JwtService.signingKey(), Keys.hmacShaKeyFor(Decoders.BASE64.decode(JwtService.secretKey)));
    }

    @Test
    void previousKeyIsOptionalAndValidatedLikeTheMainKey() {
        assertNull(JwtService.resolvePreviousSecretKey(null, CURRENT));
        assertNull(JwtService.resolvePreviousSecretKey("  ", CURRENT));
        assertNull(JwtService.resolvePreviousSecretKey(CURRENT, CURRENT));
        assertEquals(PREVIOUS, JwtService.resolvePreviousSecretKey(" " + PREVIOUS + "\n", CURRENT));
        assertThrows(IllegalStateException.class, () -> JwtService.resolvePreviousSecretKey("not-a-key", CURRENT));
        assertThrows(IllegalStateException.class,
                () -> JwtService.resolvePreviousSecretKey("0123456789abcdef0123456789abcdef", CURRENT));
    }

    @Test
    void previousKeyIsUnsetByDefault() {
        // The build/test environment does not set JWT_SECRET_KEY_PREVIOUS: one key, as before.
        if (System.getenv(JwtService.PREVIOUS_SECRET_KEY_ENV) == null) {
            assertNull(JwtService.previousSecretKey);
        }
    }
}
