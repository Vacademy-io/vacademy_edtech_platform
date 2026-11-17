package vacademy.io.admin_core_service.features.commerce.order.checkout;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.notify.InMemoryNotificationStore;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Opening a link from a message: a short order access token (24 hours at most, never past the
 * link's own end), one answer for every link that cannot be used (a bad MAC, another shop's,
 * revoked, an unknown order, an anonymised buyer), 410 for an expired one, 503 without a
 * secret, 400 without a token; and a revoke that stops every link not yet opened.
 */
class CommerceOrderLinkServiceTest {

    private static final String SECRET = "a-shared-secret-for-tests";
    private static final String INST = "inst-1";
    private static final String ORDER = "order-1";
    private static final Instant NOW = Instant.parse("2026-11-17T10:00:00Z");

    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final CommerceOrderLinkTokens links = new CommerceOrderLinkTokens(SECRET, clock);
    private final CommerceOrderAccessTokens access = new CommerceOrderAccessTokens(SECRET, clock);
    private final InMemoryNotificationStore store = new InMemoryNotificationStore();
    private final CommerceOrderDeskService desk = mock(CommerceOrderDeskService.class);
    private final CommerceAccessGuard accessGuard = mock(CommerceAccessGuard.class);
    private final CommerceAuditService audit = mock(CommerceAuditService.class);
    private CommerceOrderLinkService service;

    @BeforeEach
    void setUp() {
        order(0, true, "cust-1");
        service = service(links, access);
    }

    private CommerceOrderLinkService service(CommerceOrderLinkTokens l, CommerceOrderAccessTokens a) {
        CommerceOrderLinkService s = new CommerceOrderLinkService(l, a, store, desk, accessGuard, audit,
                mock(PlatformTransactionManager.class));
        s.setClock(clock);
        return s;
    }

    private void order(int linkEpoch, boolean phoneVerified, String customerId) {
        store.orders.put(ORDER, new CommerceNotificationStore.OrderFacts(ORDER, INST, "SH-000123", "Asha",
                "9876543210", "a@example.com", phoneVerified, "ONLINE", "user-1", "hi", new BigDecimal("1499.00"),
                "INR", null, "PREPAID", "CONFIRMED", linkEpoch, customerId));
    }

    private CheckoutException refused(String token) {
        return assertThrows(CheckoutException.class, () -> service.exchange(INST, token));
    }

    @Test
    void aGoodLinkIsExchangedForAnAccessTokenOfAtMostADay() {
        String link = links.issue(INST, ORDER, 0, "OC", Duration.ofDays(14));
        CheckoutDtos.OrderLinkExchange answer = service.exchange(INST, link);

        assertTrue(answer.getOrderAccessToken().startsWith("v1."));
        assertEquals(NOW.plus(Duration.ofHours(24)).toString(), answer.getOrderAccessTokenExpiresAt());
        assertEquals(Boolean.TRUE, answer.getPhoneVerified());
        CommerceOrderAccessTokens.Access opened = access.verify(answer.getOrderAccessToken());
        assertNotNull(opened);
        assertEquals(INST, opened.instituteId());
        assertEquals(ORDER, opened.orderId());
        assertEquals(NOW.plus(Duration.ofHours(24)), opened.expiresAt());

        // A link that ends sooner gives a token that ends with it.
        String shortLink = links.issue(INST, ORDER, 0, "OD", Duration.ofHours(2));
        CheckoutDtos.OrderLinkExchange shortAnswer = service.exchange(INST, "  " + shortLink + " ");
        assertEquals(NOW.plus(Duration.ofHours(2)).toString(), shortAnswer.getOrderAccessTokenExpiresAt());
        assertEquals(NOW.plus(Duration.ofHours(2)), access.verify(shortAnswer.getOrderAccessToken()).expiresAt());

        order(0, false, "cust-1");
        assertEquals(Boolean.FALSE, service.exchange(INST, link).getPhoneVerified());
    }

    @Test
    void issueUntilNeverGoesPastTheUsualLifetime() {
        Instant far = NOW.plus(Duration.ofDays(400));
        assertEquals(NOW.plus(Duration.ofDays(30)), access.verify(access.issueUntil(INST, ORDER, far)).expiresAt());
        assertEquals(NOW.plus(Duration.ofDays(30)), access.verify(access.issueUntil(INST, ORDER, null)).expiresAt());
        assertEquals(NOW.plus(Duration.ofHours(1)), access.verify(access.issueUntil(INST, ORDER,
                NOW.plus(Duration.ofHours(1)))).expiresAt());
    }

    @Test
    void everyUnusableLinkGetsTheSameAnswer() {
        String good = links.issue(INST, ORDER, 0, "OC", Duration.ofDays(14));
        String[] parts = good.split("\\.");
        String badMac = parts[0] + "." + parts[1] + "." + parts[2].substring(0, parts[2].length() - 2)
                + (parts[2].endsWith("AA") ? "BA" : "AA");
        String unknownOrder = links.issue(INST, "order-404", 0, "OC", Duration.ofDays(14));
        String otherShop = links.issue("inst-2", ORDER, 0, "OC", Duration.ofDays(14));
        String v1 = access.issue(INST, ORDER);

        CheckoutException first = refused(badMac);
        for (String token : new String[] {unknownOrder, otherShop, v1, "l1.x.y"}) {
            CheckoutException e = refused(token);
            assertEquals(first.getStatus(), e.getStatus(), token);
            assertEquals(first.getCode(), e.getCode(), token);
            assertEquals(first.getMessage(), e.getMessage(), token);
        }
        assertEquals(HttpStatus.FORBIDDEN, first.getStatus());
        assertEquals(CommerceOrderLinkService.LINK_INVALID, first.getCode());
    }

    @Test
    void anAnonymisedBuyersLinkIsRefusedAsInvalid() {
        String link = links.issue(INST, ORDER, 0, "OC", Duration.ofDays(14));
        store.anonymised.put("cust-1", true);
        CheckoutException e = refused(link);
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("link_invalid", e.getCode());
    }

    @Test
    void aRevokeRaisesTheEpochAndOldLinksStopWorking() {
        String old = links.issue(INST, ORDER, 0, "OC", Duration.ofDays(14));
        CommerceOrder row = new CommerceOrder();
        row.setId(ORDER);
        row.setFulfilmentLocationId("loc-1");
        when(desk.readOrder(INST, ORDER)).thenReturn(row);
        CustomUserDetails manager = mock(CustomUserDetails.class);
        when(manager.getUserId()).thenReturn("staff-1");

        Map<String, Object> answer = service.revoke(manager, INST, ORDER);

        assertEquals(Map.of("link_epoch", 1), answer);
        verify(accessGuard).require(manager, INST, CommerceFeature.ORDERS, Set.of(CommerceRole.STORE_MANAGER));
        verify(desk).authorize(manager, INST, "loc-1", Set.of(CommerceRole.STORE_MANAGER));
        verify(desk).lockOrder(INST, ORDER);
        verify(audit).record(eq(INST), eq("staff-1"), eq("loc-1"), eq("ORDER_LINKS_REVOKED"), eq("ORDER"), eq(ORDER),
                isNull(), eq("{\"link_epoch\":1}"), any());

        CheckoutException e = refused(old);
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("link_invalid", e.getCode());
        // A link made after the revoke works.
        assertNotNull(service.exchange(INST, links.issue(INST, ORDER, 1, "OC", Duration.ofDays(14)))
                .getOrderAccessToken());
    }

    @Test
    void anExpiredLinkSaysSo() {
        String link = new CommerceOrderLinkTokens(SECRET, Clock.fixed(NOW.minus(Duration.ofDays(15)), ZoneOffset.UTC))
                .issue(INST, ORDER, 0, "OC", Duration.ofDays(14));
        CheckoutException e = refused(link);
        assertEquals(HttpStatus.GONE, e.getStatus());
        assertEquals(CommerceOrderLinkService.LINK_EXPIRED, e.getCode());
    }

    @Test
    void withoutASecretTheExchangeIsNotAvailable() {
        String link = links.issue(INST, ORDER, 0, "OC", Duration.ofDays(14));
        for (CommerceOrderLinkService s : new CommerceOrderLinkService[] {
                service(new CommerceOrderLinkTokens("", clock), access),
                service(links, new CommerceOrderAccessTokens("", clock))}) {
            CheckoutException e = assertThrows(CheckoutException.class, () -> s.exchange(INST, link));
            assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
            assertEquals(CheckoutException.NOT_CONFIGURED, e.getCode());
        }
    }

    @Test
    void aMissingTokenIsABadRequest() {
        for (String none : new String[] {null, "", "   "}) {
            CheckoutException e = refused(none);
            assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
            assertEquals(CheckoutException.INVALID_REQUEST, e.getCode());
        }
    }
}
