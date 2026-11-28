package vacademy.io.notification_service.features.engagement_ledger.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Whether a reply to a sender can reach us: the MX parsing, and the lookup's caching and failures. */
class EngagementReplyReachabilityTest {

    @Test
    @DisplayName("reachesUs: the lowest-preference host decides, whatever the order")
    void lowestPreferenceDecides() {
        assertTrue(EmailReplyMx.reachesUs(List.of("10 inbound-smtp.us-east-1.amazonaws.com.")));
        assertTrue(EmailReplyMx.reachesUs(List.of("10 inbound-smtp.ap-south-1.amazonaws.com")));
        assertTrue(EmailReplyMx.reachesUs(List.of("10 INBOUND-SMTP.EU-WEST-1.AMAZONAWS.COM.")));
        assertTrue(EmailReplyMx.reachesUs(List.of("20 aspmx.l.google.com.", "10 inbound-smtp.us-east-1.amazonaws.com.")));
        assertFalse(EmailReplyMx.reachesUs(List.of("10 aspmx.l.google.com.", "20 inbound-smtp.us-east-1.amazonaws.com.")));
    }

    @Test
    @DisplayName("reachesUs: anything but SES inbound does not reach us")
    void otherHostsDoNot() {
        assertFalse(EmailReplyMx.reachesUs(List.of("1 smtp.google.com.")));
        assertFalse(EmailReplyMx.reachesUs(List.of("0 example-com.mail.protection.outlook.com.")));
        assertFalse(EmailReplyMx.reachesUs(List.of("10 inbound-smtp.amazonaws.com.")));
        assertFalse(EmailReplyMx.reachesUs(List.of("10 inbound-smtp.us-east-1.amazonaws.com.evil.example.")));
        assertFalse(EmailReplyMx.reachesUs(List.of("10 smtp.us-east-1.amazonaws.com.")));
        // "No mail accepted" (RFC 7505) and no MX at all are answers too.
        assertFalse(EmailReplyMx.reachesUs(List.of("0 .")));
        assertFalse(EmailReplyMx.reachesUs(List.of()));
    }

    @Test
    @DisplayName("reachesUs: a tie at the lowest preference reaches us if either host is SES")
    void aTieIsEnough() {
        assertTrue(EmailReplyMx.reachesUs(List.of("10 aspmx.l.google.com.", "10 inbound-smtp.us-east-1.amazonaws.com.")));
        assertTrue(EmailReplyMx.reachesUs(List.of("10 inbound-smtp.us-east-1.amazonaws.com.", "10 aspmx.l.google.com.")));
    }

    @Test
    @DisplayName("reachesUs: unreadable records are skipped; only those means no answer, so reachable")
    void badRecords() {
        assertFalse(EmailReplyMx.reachesUs(Arrays.asList("garbage", null, "10 aspmx.l.google.com.", "x y")));
        assertTrue(EmailReplyMx.reachesUs(Arrays.asList("garbage", null, "x y", "1 2 3")));
    }

    @Test
    @DisplayName("domainOf: bare and display-name addresses, lower case, no domain is null")
    void domains() {
        assertEquals("example.com", EmailReplyMx.domainOf("hello@Example.com"));
        assertEquals("example.com", EmailReplyMx.domainOf(" Academy <hello@EXAMPLE.com> "));
        assertEquals("example.com", EmailReplyMx.domainOf("a@b@example.com"));
        assertNull(EmailReplyMx.domainOf(null));
        assertNull(EmailReplyMx.domainOf("935184396337916"));
        assertNull(EmailReplyMx.domainOf("hello@"));
        assertNull(EmailReplyMx.domainOf("hello@exa mple.com"));
    }

    @Test
    @DisplayName("unreachable: names the addresses, sorted; one lookup per domain, however many senders")
    void onlyUnreachableAddressesAreNamedAndLookupsAreCached() {
        Map<String, List<String>> dns = Map.of(
                "ses.example", List.of("10 inbound-smtp.us-east-1.amazonaws.com."),
                "gmail.example", List.of("5 gmail-smtp-in.l.google.com."),
                "nomx.example", List.of());
        List<String> asked = new ArrayList<>();
        EngagementReplyReachabilityService service = new EngagementReplyReachabilityService(domain -> {
            asked.add(domain);
            return dns.get(domain);
        });

        List<String> gone = service.unreachable(List.of("z@gmail.example", "a@gmail.example", "ok@ses.example",
                "x@nomx.example", "not-an-address"));
        service.unreachable(List.of("b@gmail.example", "other@ses.example"));

        assertEquals(List.of("a@gmail.example", "x@nomx.example", "z@gmail.example"), gone);
        assertEquals(Set.of("gmail.example", "ses.example", "nomx.example"), Set.copyOf(asked));
        assertEquals(3, asked.size());
    }

    @Test
    @DisplayName("unreachable: a failed lookup counts as reachable and is not asked again straight away")
    void aFailedLookupIsReachable() {
        AtomicInteger asked = new AtomicInteger();
        EngagementReplyReachabilityService service = new EngagementReplyReachabilityService(domain -> {
            asked.incrementAndGet();
            throw new javax.naming.ServiceUnavailableException("timeout");
        });

        assertTrue(service.unreachable(List.of("hello@down.example")).isEmpty());
        assertTrue(service.unreachable(List.of("other@down.example")).isEmpty());
        assertEquals(1, asked.get());
    }
}
