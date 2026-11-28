package vacademy.io.admin_core_service.features.commerce.order.checkout;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderStatusHistoryRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The buyer's account routes: session or phone token, masked rows, consent, sign out, and the order page. */
class CommerceOrderQueryServiceAccountTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "919876543210";

    private CommerceOrderRepository orderRepository;
    private CommerceOrderLineRepository lineRepository;
    private CommerceCustomerService customerService;
    private CommerceShopperSessions sessions;
    private VerifiedPhones verifiedPhones;
    private CommercePaymentConfirmService paymentConfirmService;
    private CommerceOrderAccessTokens accessTokens;
    private CommerceOrderQueryService service;
    private CommerceCustomer customer;

    @BeforeEach
    void setUp() {
        orderRepository = mock(CommerceOrderRepository.class);
        lineRepository = mock(CommerceOrderLineRepository.class);
        customerService = mock(CommerceCustomerService.class);
        sessions = mock(CommerceShopperSessions.class);
        verifiedPhones = mock(VerifiedPhones.class);
        paymentConfirmService = mock(CommercePaymentConfirmService.class);
        accessTokens = new CommerceOrderAccessTokens("unit-test-signing-key", Clock.systemUTC());
        service = new CommerceOrderQueryService(orderRepository, lineRepository,
                mock(CommerceOrderTenderRepository.class), mock(CommerceOrderStatusHistoryRepository.class),
                customerService, accessTokens, verifiedPhones, sessions, paymentConfirmService, new ObjectMapper(),
                mock(PlatformTransactionManager.class));
        customer = new CommerceCustomer();
        customer.setId("cust-1");
        customer.setName("Asha");
        customer.setEmail("asha@example.com");
        customer.setPhone(PHONE);
        when(customerService.findByPhone(INSTITUTE, PHONE)).thenReturn(Optional.of(customer));
        when(sessions.isConfigured()).thenReturn(true);
        when(sessions.verify(INSTITUTE, "s1.good")).thenReturn(new CommerceShopperSessions.Session(INSTITUTE,
                "cust-1", PHONE, Instant.parse("2026-11-22T10:00:00Z")));
        when(lineRepository.findByOrderIdInOrderByOrderIdAscLineNoAsc(any())).thenReturn(List.of());
    }

    private static CommerceOrder order(String id, boolean phoneVerified) {
        CommerceOrder order = new CommerceOrder();
        order.setId(id);
        order.setInstituteId(INSTITUTE);
        order.setOrderNumber("ORD-" + id);
        order.setStatus("CONFIRMED");
        order.setPaymentStatus("PAID");
        order.setCurrency("INR");
        order.setTotal(new BigDecimal("1050.00"));
        order.setCreatedAt(LocalDateTime.of(2026, 11, 15, 10, 0));
        order.setPhoneVerified(phoneVerified);
        return order;
    }

    @Test
    void ordersPlacedWithThePhoneByNobodyWhoProvedItAreMaskedRows() {
        when(orderRepository.findByInstituteIdAndCustomerIdOrderByCreatedAtDesc(eq(INSTITUTE), eq("cust-1"),
                any(Pageable.class))).thenReturn(new PageImpl<>(List.of(order("a", true), order("b", false))));

        CheckoutDtos.OrderPage page = service.myOrders(INSTITUTE, "s1.good", null, 0, 20);

        CheckoutDtos.OrderSummary verified = page.getOrders().get(0);
        assertFalse(verified.isMasked());
        assertNotNull(verified.getOrderAccessToken());
        assertEquals(new BigDecimal("1050.00"), verified.getTotal());
        CheckoutDtos.OrderSummary masked = page.getOrders().get(1);
        assertTrue(masked.isMasked());
        assertEquals("ORD-b", masked.getOrderNumber());
        assertEquals("CONFIRMED", masked.getStatus());
        assertNotNull(masked.getPlacedAt());
        assertNull(masked.getOrderId());
        assertNull(masked.getTotal());
        assertNull(masked.getItemCount());
        assertNull(masked.getPaymentStatus());
        assertNull(masked.getOrderAccessToken());
        assertNull(masked.getFirstItemName());
    }

    @Test
    void trackOrderShowsOnlyTheStateOfAnOrderWhosePhoneWasNotProved() {
        when(verifiedPhones.phoneOf(INSTITUTE, "track-token", VerifiedPhones.PURPOSE_TRACK_ORDER)).thenReturn(PHONE);
        CommerceOrder proved = order("a", true);
        proved.setCustomerPhone(PHONE);
        proved.setShippingAddressJson("{\"name\":\"Asha\",\"city\":\"Varanasi\",\"pincode\":\"221001\"}");
        CommerceOrder unproved = order("b", false);
        unproved.setCustomerPhone(PHONE);
        unproved.setShippingAddressJson("{\"name\":\"Someone Else\",\"city\":\"Varanasi\",\"pincode\":\"221001\"}");
        when(orderRepository.findByInstituteIdAndOrderNumber(INSTITUTE, "ORD-a")).thenReturn(Optional.of(proved));
        when(orderRepository.findByInstituteIdAndOrderNumber(INSTITUTE, "ORD-b")).thenReturn(Optional.of(unproved));

        CheckoutDtos.OrderView full = service.track(INSTITUTE, "ORD-a", "track-token");
        assertFalse(full.isMasked());
        assertEquals("a", full.getOrderId());
        assertNotNull(full.getTotals());
        assertEquals("Asha", full.getRecipient().getName());

        CheckoutDtos.OrderView state = service.track(INSTITUTE, "ORD-b", "track-token");
        assertTrue(state.isMasked());
        assertEquals("ORD-b", state.getOrderNumber());
        assertEquals("CONFIRMED", state.getStatus());
        assertNotNull(state.getPlacedAt());
        assertNull(state.getOrderId());
        assertNull(state.getLines());
        assertNull(state.getTotals());
        assertNull(state.getRecipient());
        assertNull(state.getCurrency());
        assertFalse(state.isPaymentRetryable());

        // Another phone's order is "not found", as before.
        unproved.setCustomerPhone("919999999999");
        CheckoutException e = assertThrows(CheckoutException.class,
                () -> service.track(INSTITUTE, "ORD-b", "track-token"));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
    }

    @Test
    void aBadSessionIs401WithNoFallbackToThePhoneToken() {
        when(verifiedPhones.phoneOf(eq(INSTITUTE), eq("phone-token"), anyString())).thenReturn(PHONE);

        CheckoutException e = assertThrows(CheckoutException.class,
                () -> service.me(INSTITUTE, "s1.expired", "phone-token"));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        assertEquals(CheckoutException.SESSION_INVALID, e.getCode());
    }

    @Test
    void withoutASessionAPhoneTokenOfCheckoutOrAccountIsAccepted() {
        when(verifiedPhones.phoneOf(INSTITUTE, "account-token", "ACCOUNT")).thenReturn(PHONE);
        assertEquals(PHONE, service.requireBuyer(INSTITUTE, null, "account-token").phone());

        when(verifiedPhones.phoneOf(INSTITUTE, "checkout-token", "CHECKOUT")).thenReturn(PHONE);
        assertEquals(PHONE, service.requireBuyer(INSTITUTE, " ", "checkout-token").phone());

        CheckoutException e = assertThrows(CheckoutException.class,
                () -> service.requireBuyer(INSTITUTE, null, "track-order-token"));
        assertEquals(CheckoutException.TOKEN_INVALID, e.getCode());
    }

    @Test
    void aSessionHeaderWithoutASecretIs503() {
        when(sessions.isConfigured()).thenReturn(false);
        CheckoutException e = assertThrows(CheckoutException.class, () -> service.me(INSTITUTE, "s1.good", null));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertEquals(CheckoutException.NOT_CONFIGURED, e.getCode());
    }

    @Test
    void meShowsMaskedContactsAndTheSessionEnd() {
        CheckoutDtos.Account me = service.me(INSTITUTE, "s1.good", null);

        assertEquals("Asha", me.getName());
        assertEquals(PHONE, me.getPhone(), "the phone the session proved, so the device need not keep it");
        assertEquals("••••••3210", me.getPhoneMasked());
        assertEquals("a•••@example.com", me.getEmailMasked());
        assertFalse(me.isMarketingConsent());
        assertEquals("2026-11-22T10:00:00Z", me.getSessionExpiresAt());

        customer.setEmail("b-0123456789abcdef01234567@buyer.invalid");
        assertNull(service.me(INSTITUTE, "s1.good", null).getEmailMasked(), "a holder address is no e-mail");
    }

    @Test
    void consentIsRecordedWithSourceAccount_andFalseWithdrawsIt() {
        when(customerService.findOrCreateUnverified(INSTITUTE, PHONE)).thenReturn(customer);

        service.setConsent(INSTITUTE, "s1.good", null, true);
        service.setConsent(INSTITUTE, "s1.good", null, false);

        verify(customerService).setConsent(customer, true, "ACCOUNT");
        verify(customerService).setConsent(customer, false, "ACCOUNT");
        assertThrows(CheckoutException.class, () -> service.setConsent(INSTITUTE, "s1.good", null, null));
    }

    @Test
    void signingOutEndsEverySessionOfTheCustomer() {
        service.logoutEverywhere(INSTITUTE, "s1.good", null);
        verify(sessions).endAll(INSTITUTE, "cust-1");

        when(sessions.verify(INSTITUTE, "s1.old")).thenReturn(null);
        assertThrows(CheckoutException.class, () -> service.logoutEverywhere(INSTITUTE, "s1.old", null));
        verify(sessions, never()).endAll(INSTITUTE, "other");
    }

    @Test
    void theOrderPageSaysProcessingAndOffersNoPaymentWhileAPaymentIsAuthorised() {
        CommerceOrder pending = order("p", true);
        pending.setStatus("PENDING_PAYMENT");
        pending.setPaymentStatus("UNPAID");
        pending.setHoldExpiresAt(new Date(System.currentTimeMillis() + 600_000L));
        when(orderRepository.findByIdAndInstituteId("p", INSTITUTE)).thenReturn(Optional.of(pending));
        String token = accessTokens.issue(INSTITUTE, "p");

        when(paymentConfirmService.paymentInProgress("p")).thenReturn(true);
        CheckoutDtos.OrderView processing = service.viewByToken(INSTITUTE, token);
        assertTrue(processing.isPaymentProcessing());
        assertFalse(processing.isPaymentRetryable());

        when(paymentConfirmService.paymentInProgress("p")).thenReturn(false);
        CheckoutDtos.OrderView payable = service.viewByToken(INSTITUTE, token);
        assertFalse(payable.isPaymentProcessing());
        assertTrue(payable.isPaymentRetryable());
    }

    @Test
    void emailMasking() {
        assertEquals("a•••@example.com", CommerceOrderQueryService.maskEmail("asha@example.com"));
        assertNull(CommerceOrderQueryService.maskEmail(null));
        assertNull(CommerceOrderQueryService.maskEmail("@example.com"));
    }
}
