package vacademy.io.admin_core_service.features.commerce.order.checkout;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.notify.LogCapture;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The order link token of a buyer's message: it round-trips, it is bound to its institute, any
 * changed byte breaks it, it reads as expired only once its MAC is good, it carries the order's
 * link epoch, no other commerce token verifies as a link or the other way round, it needs a
 * secret, it is short, and it never reaches a log.
 */
class CommerceOrderLinkTokensTest {

    private static final String SECRET = "a-shared-secret-for-tests";
    private static final String INST = "inst-1";
    private static final String OTHER_INST = "inst-2";
    private static final String ORDER = "0b6f2a3c-8d41-4f7e-9a10-1c2d3e4f5a6b";
    private static final Instant NOW = Instant.parse("2026-11-17T10:00:00Z");

    private static CommerceOrderLinkTokens tokens(String secret, Instant now) {
        return new CommerceOrderLinkTokens(secret, Clock.fixed(now, ZoneOffset.UTC));
    }

    private static String flip(String b64, int index) {
        byte[] bytes = Base64.getUrlDecoder().decode(b64);
        bytes[index] ^= 0x01;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    @Test
    void aTokenReadsBackAsItWasIssued() {
        CommerceOrderLinkTokens t = tokens(SECRET, NOW);
        assertTrue(t.isConfigured());
        String token = t.issue(INST, ORDER, 3, "OC", Duration.ofDays(14));
        assertTrue(token.startsWith("l1."));
        assertEquals(3, token.split("\\.", -1).length);

        CommerceOrderLinkTokens.Read read = t.verify(INST, token);
        assertEquals(CommerceOrderLinkTokens.Status.VALID, read.status());
        assertEquals(ORDER, read.orderId());
        assertEquals(NOW.plus(Duration.ofDays(14)), read.expiresAt());
        assertEquals(3, read.linkEpoch());
        assertEquals("OC", read.triggerTag());
        // Surrounding white space is the caller's to trim; the token itself is exact.
        assertEquals(CommerceOrderLinkTokens.Status.INVALID, t.verify(INST, " " + token).status());
    }

    @Test
    void aTokenOfOneInstituteNeverVerifiesForAnother() {
        CommerceOrderLinkTokens t = tokens(SECRET, NOW);
        String token = t.issue(INST, ORDER, 0, "OS", Duration.ofDays(1));
        CommerceOrderLinkTokens.Read read = t.verify(OTHER_INST, token);
        assertEquals(CommerceOrderLinkTokens.Status.INVALID, read.status());
        assertNull(read.orderId());
        // Nor with another secret.
        assertEquals(CommerceOrderLinkTokens.Status.INVALID, tokens("another-secret", NOW).verify(INST, token)
                .status());
    }

    @Test
    void anyChangedByteOfThePayloadOrTheMacBreaksTheToken() {
        CommerceOrderLinkTokens t = tokens(SECRET, NOW);
        String token = t.issue(INST, ORDER, 2, "RP", Duration.ofDays(14));
        String[] parts = token.split("\\.");
        int payloadBytes = Base64.getUrlDecoder().decode(parts[1]).length;
        int macBytes = Base64.getUrlDecoder().decode(parts[2]).length;
        assertEquals(16, macBytes, "the first 16 bytes of the HMAC");
        for (int i = 0; i < payloadBytes; i++) {
            String changed = parts[0] + "." + flip(parts[1], i) + "." + parts[2];
            assertEquals(CommerceOrderLinkTokens.Status.INVALID, t.verify(INST, changed).status(), "payload " + i);
        }
        for (int i = 0; i < macBytes; i++) {
            String changed = parts[0] + "." + parts[1] + "." + flip(parts[2], i);
            assertEquals(CommerceOrderLinkTokens.Status.INVALID, t.verify(INST, changed).status(), "mac " + i);
        }
        // A later expiry with the old MAC.
        String later = Base64.getUrlEncoder().withoutPadding().encodeToString(
                (ORDER + "|" + NOW.plus(Duration.ofDays(400)).getEpochSecond() + "|2|RP")
                        .getBytes(StandardCharsets.UTF_8));
        assertEquals(CommerceOrderLinkTokens.Status.INVALID, t.verify(INST, "l1." + later + "." + parts[2]).status());
        for (String broken : new String[] {"", "l1", "l1..", "l1.a.b.c", "l2." + parts[1] + "." + parts[2],
                parts[1] + "." + parts[2], "l1." + parts[1] + ".", "l1.%%%." + parts[2], null}) {
            assertEquals(CommerceOrderLinkTokens.Status.INVALID, t.verify(INST, broken).status(), "" + broken);
        }
    }

    @Test
    void expiredIsAnsweredOnlyForATokenWhoseMacIsGood() {
        String token = tokens(SECRET, NOW).issue(INST, ORDER, 1, "OD", Duration.ofDays(14));
        CommerceOrderLinkTokens later = tokens(SECRET, NOW.plus(Duration.ofDays(14)));
        CommerceOrderLinkTokens.Read read = later.verify(INST, token);
        assertEquals(CommerceOrderLinkTokens.Status.EXPIRED, read.status(), "at the expiry second it has ended");
        assertEquals(ORDER, read.orderId());
        assertEquals(CommerceOrderLinkTokens.Status.VALID, tokens(SECRET, NOW.plus(Duration.ofDays(14))
                .minusSeconds(1)).verify(INST, token).status());

        // The same expired token with a broken MAC, or from another institute, is just invalid.
        String[] parts = token.split("\\.");
        assertEquals(CommerceOrderLinkTokens.Status.INVALID,
                later.verify(INST, parts[0] + "." + parts[1] + "." + flip(parts[2], 0)).status());
        assertEquals(CommerceOrderLinkTokens.Status.INVALID, later.verify(OTHER_INST, token).status());
    }

    @Test
    void theLinkEpochAndTheTagAreCarried() {
        CommerceOrderLinkTokens t = tokens(SECRET, NOW);
        assertEquals(0, t.verify(INST, t.issue(INST, ORDER, 0, "PB", Duration.ofDays(1))).linkEpoch());
        assertEquals(41, t.verify(INST, t.issue(INST, ORDER, 41, "PB", Duration.ofDays(1))).linkEpoch());
        assertEquals("XX", t.verify(INST, t.issue(INST, ORDER, 0, "bad", Duration.ofDays(1))).triggerTag());
        assertEquals("XX", t.verify(INST, t.issue(INST, ORDER, 0, null, Duration.ofDays(1))).triggerTag());
        assertThrows(IllegalArgumentException.class, () -> t.issue(INST, "a|b", 0, "OC", Duration.ofDays(1)));
        assertThrows(IllegalArgumentException.class, () -> t.issue(INST, ORDER, -1, "OC", Duration.ofDays(1)));
        assertThrows(IllegalArgumentException.class, () -> t.issue(null, ORDER, 0, "OC", Duration.ofDays(1)));
    }

    @Test
    void orderAccessTokensAndShopperSessionsNeverVerifyAsLinksNorTheOtherWay() {
        CommerceOrderLinkTokens links = tokens(SECRET, NOW);
        CommerceOrderAccessTokens access = new CommerceOrderAccessTokens(SECRET, Clock.fixed(NOW, ZoneOffset.UTC));
        String link = links.issue(INST, ORDER, 0, "OC", Duration.ofDays(14));
        String v1 = access.issue(INST, ORDER);
        assertNotNull(access.verify(v1));

        assertEquals(CommerceOrderLinkTokens.Status.INVALID, links.verify(INST, v1).status());
        assertEquals(CommerceOrderLinkTokens.Status.INVALID, links.verify(INST, "l1" + v1.substring(2)).status());
        assertNull(access.verify(link));
        assertNull(access.verify("v1" + link.substring(2)));

        // A shopper session of the same secret.
        CommerceCustomerRepository customers = mock(CommerceCustomerRepository.class);
        CommerceCustomerRepository.SessionRow row = mock(CommerceCustomerRepository.SessionRow.class);
        when(row.getId()).thenReturn("cust-1");
        when(row.getPhone()).thenReturn("919876543210");
        when(row.getSessionEpoch()).thenReturn(0);
        when(customers.findSessionRowByPhone(anyString(), anyString())).thenReturn(Optional.of(row));
        when(customers.findSessionRow(anyString(), anyString())).thenReturn(Optional.of(row));
        CommerceShopperSessions sessions = new CommerceShopperSessions(customers,
                mock(PlatformTransactionManager.class), SECRET, "");
        String s1 = sessions.issueForPhone(INST, "919876543210").token();
        assertNotNull(sessions.verify(INST, s1));
        assertTrue(s1.startsWith("s1."));

        assertEquals(CommerceOrderLinkTokens.Status.INVALID, links.verify(INST, s1).status());
        assertEquals(CommerceOrderLinkTokens.Status.INVALID, links.verify(INST, "l1" + s1.substring(2)).status());
        assertNull(sessions.verify(INST, link));
        assertNull(sessions.verify(INST, "s1" + link.substring(2)));
    }

    @Test
    void withoutASecretNoTokenIsMadeOrAccepted() {
        for (String none : new String[] {null, "", "   "}) {
            CommerceOrderLinkTokens t = tokens(none, NOW);
            assertFalse(t.isConfigured());
            IllegalStateException e = assertThrows(IllegalStateException.class,
                    () -> t.issue(INST, ORDER, 0, "OC", Duration.ofDays(14)));
            assertFalse(e.getMessage().contains(ORDER));
        }
        String good = tokens(SECRET, NOW).issue(INST, ORDER, 0, "OC", Duration.ofDays(14));
        assertEquals(CommerceOrderLinkTokens.Status.INVALID, tokens("", NOW).verify(INST, good).status());
    }

    @Test
    void aTokenIsShortAndOfPlainCharacters() {
        CommerceOrderLinkTokens t = tokens(SECRET, NOW);
        String token = t.issue(INST, ORDER, Integer.MAX_VALUE, "RP", Duration.ofDays(30));
        assertTrue(token.length() <= 200, "length " + token.length());
        assertTrue(token.matches("[A-Za-z0-9._-]+"), token);
        String link = "https://shop.example.com/a-long-site-tag/order#l=" + token;
        assertTrue(link.length() <= 300, "fits the link cap");
        assertEquals(CommerceOrderLinkTokens.Status.INVALID, t.verify(INST, token + "A".repeat(201)).status());
        assertEquals(CommerceOrderLinkTokens.Status.INVALID, t.verify(INST, token.replace('.', '+')).status());
    }

    @Test
    void noTokenEverReachesALog() {
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE)) {
            CommerceOrderLinkTokens t = tokens(SECRET, NOW);
            String token = t.issue(INST, ORDER, 0, "OC", Duration.ofDays(14));
            t.verify(INST, token);
            t.verify(OTHER_INST, token);
            t.verify(INST, token + "x");
            tokens(SECRET, NOW.plus(Duration.ofDays(30))).verify(INST, token);
            tokens(null, NOW).verify(INST, token);
            String[] parts = token.split("\\.");
            for (String text : logs.everything()) {
                assertFalse(text.contains("l1."), text);
                assertFalse(text.contains(parts[1]) || text.contains(parts[2]), text);
                assertFalse(text.contains(ORDER), text);
            }
        }
    }
}
