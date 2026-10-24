package vacademy.io.common.auth.apikey;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ApiKeyAuthenticationTest {

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private static ApiKeyPrincipal principal() {
        return ApiKeyPrincipal.builder().keyId("k").instituteId("i").status("ACTIVE")
                .products(List.of("evaluation")).scopes(List.of("evaluation:read")).accessEnabled(true).build();
    }

    @Test
    void cannotBeReAuthenticatedOnceCleared() {
        ApiKeyAuthentication auth = new ApiKeyAuthentication(principal());
        assertTrue(auth.isAuthenticated());
        assertThrows(IllegalArgumentException.class, () -> auth.setAuthenticated(true));
        auth.setAuthenticated(false);
        assertFalse(auth.isAuthenticated());
    }

    @Test
    void currentIsEmptyForAJwtUserEvenWithAnApiKeyLookingAuthority() {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                "user", null, List.of(new SimpleGrantedAuthority("API_KEY"))));
        assertTrue(ApiKeyAuthentication.current().isEmpty());
    }

    @Test
    void currentReturnsThePrincipal() {
        ApiKeyPrincipal p = principal();
        SecurityContextHolder.getContext().setAuthentication(new ApiKeyAuthentication(p));
        assertEquals(p, ApiKeyAuthentication.current().orElseThrow());
    }

    @Test
    void principalHelpers() {
        ApiKeyPrincipal p = principal();
        assertTrue(p.hasScope("evaluation:read"));
        assertFalse(p.hasScope("evaluation:write"));
        assertFalse(p.hasScope(null));
        assertTrue(p.hasProduct("evaluation"));
        assertTrue(p.isActive());
        assertFalse(p.isExpired(Instant.now()));
        assertEquals("apikey:k", p.actorId());
        Instant t = Instant.parse("2026-10-01T00:00:00Z");
        ApiKeyPrincipal expiring = p.toBuilder().expiresAt(t).build();
        assertTrue(expiring.isExpired(t));
        assertFalse(expiring.isExpired(t.minusMillis(1)));
        assertThrows(UnsupportedOperationException.class, () -> p.getScopes().add("x"));
        assertEquals(Set.of(), ApiKeyPrincipal.builder().build().getScopes());
    }
}
