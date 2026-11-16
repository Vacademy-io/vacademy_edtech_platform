package vacademy.io.admin_core_service.features.commerce.order.checkout;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CommerceOrderAccessTokensTest {

    private static final Instant NOW = Instant.parse("2026-11-14T10:00:00Z");
    private static final String KEY_FOR_TESTS = "unit-test-signing-key";

    private static CommerceOrderAccessTokens at(Instant now, String secret) {
        return new CommerceOrderAccessTokens(secret, Clock.fixed(now, ZoneOffset.UTC));
    }

    @Test
    void aTokenOpensItsOrderUntilItExpires() {
        CommerceOrderAccessTokens tokens = at(NOW, KEY_FOR_TESTS);
        String token = tokens.issue("inst-1", "order-1");
        CommerceOrderAccessTokens.Access access = tokens.verify(token);
        assertNotNull(access);
        assertEquals("inst-1", access.instituteId());
        assertEquals("order-1", access.orderId());
        assertEquals(NOW.plus(CommerceOrderAccessTokens.LIFETIME), access.expiresAt());

        assertNotNull(at(NOW.plus(CommerceOrderAccessTokens.LIFETIME).minusSeconds(1), KEY_FOR_TESTS).verify(token));
        assertNull(at(NOW.plus(CommerceOrderAccessTokens.LIFETIME), KEY_FOR_TESTS).verify(token));
    }

    @Test
    void aChangedTokenIsRefused() {
        CommerceOrderAccessTokens tokens = at(NOW, KEY_FOR_TESTS);
        String token = tokens.issue("inst-1", "order-1");
        String other = tokens.issue("inst-1", "order-2");
        assertNotEquals(token, other);
        // The body of one token with the signature of another.
        String[] a = token.split("\\.");
        String[] b = other.split("\\.");
        assertNull(tokens.verify(a[0] + "." + b[1] + "." + a[2]));
        assertNull(tokens.verify(a[0] + "." + a[1] + "." + b[2]));
        assertNull(tokens.verify("v2." + a[1] + "." + a[2]));
        assertNull(tokens.verify(a[1] + "." + a[2]));
        assertNull(tokens.verify("not a token"));
        assertNull(tokens.verify(""));
        assertNull(tokens.verify(null));
        assertNull(tokens.verify("v1.%%%." + a[2]));
        assertNull(tokens.verify("x".repeat(600)));
    }

    @Test
    void aTokenOfAnotherKeyIsRefused() {
        String token = at(NOW, KEY_FOR_TESTS).issue("inst-1", "order-1");
        assertNull(at(NOW, "another-key").verify(token));
    }

    @Test
    void withNoKeyNothingIsIssuedOrAccepted() {
        CommerceOrderAccessTokens off = at(NOW, " ");
        assertFalse(off.isConfigured());
        assertThrows(IllegalStateException.class, () -> off.issue("inst-1", "order-1"));
        assertNull(off.verify(at(NOW, KEY_FOR_TESTS).issue("inst-1", "order-1")));
        assertTrue(at(NOW, KEY_FOR_TESTS).isConfigured());
    }

    @Test
    void idsThatWouldBreakThePayloadAreRefused() {
        CommerceOrderAccessTokens tokens = at(NOW, KEY_FOR_TESTS);
        assertThrows(IllegalArgumentException.class, () -> tokens.issue("inst|1", "order-1"));
        assertThrows(IllegalArgumentException.class, () -> tokens.issue("inst-1", null));
    }
}
