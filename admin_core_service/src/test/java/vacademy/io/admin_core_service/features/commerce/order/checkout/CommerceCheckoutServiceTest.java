package vacademy.io.admin_core_service.features.commerce.order.checkout;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CartPricingException;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceBotCheck;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;

import java.math.BigDecimal;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceRateLimiter;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Placing an order: idempotency, the price check, the caps, the order of the remote calls and
 * the gateway step. The gateway is a stub behind {@link CheckoutGateway}; nothing leaves the JVM.
 */
class CommerceCheckoutServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "919876543210";

    private CommerceOrderService orderService;
    private CommerceOrderWriter writer;
    private CommerceBuyerResolver buyerResolver;
    private CommerceCounterService counterService;
    private CommerceOrderRepository orderRepository;
    private CommerceOrderLineRepository lineRepository;
    private CommerceOrderLegacyRepository legacyRepository;
    private CheckoutGateway gateway;
    private CommerceOrderAccessTokens accessTokens;
    private CommerceBotCheck botCheck;
    private CommercePaymentConfirmService paymentConfirmService;
    private CommerceOrderPaymentService orderPaymentService;
    private CommerceRateLimiter rateLimiter;
    private VerifiedPhones verifiedPhones;
    private CommerceShopperSessions sessions;
    private CommerceStorefrontSettings storefrontSettings;
    private BuyerIdentity mode = BuyerIdentity.EITHER;
    private CommerceCheckoutService service;

    /** The orders "in the database", by client_request_id. */
    private final List<CommerceOrder> stored = new ArrayList<>();
    private CartPriceDtos.CartPrice view;
    private BigDecimal serverTotal = new BigDecimal("1050.00");
    private String placeState = "09";

    @BeforeEach
    void setUp() {
        orderService = mock(CommerceOrderService.class);
        writer = mock(CommerceOrderWriter.class);
        buyerResolver = mock(CommerceBuyerResolver.class);
        counterService = mock(CommerceCounterService.class);
        CommerceStockSettings stockSettings = mock(CommerceStockSettings.class);
        orderRepository = mock(CommerceOrderRepository.class);
        lineRepository = mock(CommerceOrderLineRepository.class);
        legacyRepository = mock(CommerceOrderLegacyRepository.class);
        gateway = mock(CheckoutGateway.class);
        accessTokens = new CommerceOrderAccessTokens("unit-test-signing-key", Clock.systemUTC());
        botCheck = mock(CommerceBotCheck.class);
        paymentConfirmService = mock(CommercePaymentConfirmService.class);
        verifiedPhones = mock(VerifiedPhones.class);
        orderPaymentService = mock(CommerceOrderPaymentService.class);
        rateLimiter = mock(CommerceRateLimiter.class);
        when(rateLimiter.allow(anyString(), anyString(), anyString(), any(), anyInt())).thenReturn(true);
        // The stock of an order that waits for its payment is held, unless a test says otherwise.
        when(orderPaymentService.ensurePayable(anyString())).thenAnswer(call ->
                "PENDING_PAYMENT".equals(byId(call.getArgument(0)).getStatus()));
        sessions = mock(CommerceShopperSessions.class);
        storefrontSettings = mock(CommerceStorefrontSettings.class);
        when(storefrontSettings.read(INSTITUTE)).thenAnswer(call -> {
            StorefrontSettings d = StorefrontSettings.defaults();
            return new StorefrontSettings(d.baseLocale(), d.lowStockThreshold(), d.leadMediaTag(), d.priceBands(),
                    d.dispatchPromise(), d.cod(), d.pricingRulesJson(), d.maxOrderQuantity(), d.mediaTags(), mode,
                    d.otpInstituteHourlyCap());
        });
        service = new CommerceCheckoutService(orderService, writer, buyerResolver, counterService, stockSettings,
                orderRepository, lineRepository, legacyRepository, gateway, accessTokens, botCheck,
                paymentConfirmService, orderPaymentService, rateLimiter, verifiedPhones, sessions, storefrontSettings,
                new ObjectMapper(), mock(PlatformTransactionManager.class));

        view = CartPriceDtos.CartPrice.builder().currency("INR").unavailable(List.of()).build();
        when(orderService.priceCart(eq(INSTITUTE), any(CartPriceRequest.class))).thenAnswer(call ->
                new CommerceOrderService.CartPrice(snapshot(), view));
        when(botCheck.verify(eq(INSTITUTE), any(), any())).thenReturn(true);
        when(buyerResolver.resolve(eq(INSTITUTE), any(), eq(PHONE), anyString(), any(), anyBoolean()))
                .thenAnswer(call -> new CommerceBuyerResolver.Buyer("user-1", call.getArgument(5)));
        when(counterService.nextNumber(INSTITUTE, "ORD")).thenReturn("ORD-000007");
        when(stockSettings.holdMinutes(INSTITUTE)).thenReturn(15);

        when(orderRepository.findByInstituteIdAndClientRequestId(eq(INSTITUTE), anyString())).thenAnswer(call ->
                stored.stream().filter(o -> o.getClientRequestId().equals(call.getArgument(1))).findFirst());
        when(orderRepository.findById(anyString())).thenAnswer(call ->
                stored.stream().filter(o -> o.getId().equals(call.getArgument(0))).findFirst());
        when(orderRepository.findByIdAndInstituteId(anyString(), eq(INSTITUTE))).thenAnswer(call ->
                stored.stream().filter(o -> o.getId().equals(call.getArgument(0))).findFirst());
        when(orderRepository.claimGatewayAttempt(anyString(), any(Date.class), any(Date.class))).thenAnswer(call -> {
            CommerceOrder order = byId(call.getArgument(0));
            if (order.getGatewayOrderId() != null || order.getGatewayAttemptAt() != null) {
                return 0;
            }
            order.setGatewayAttemptAt(call.getArgument(1));
            return 1;
        });
        when(orderRepository.releaseGatewayAttempt(anyString())).thenAnswer(call -> {
            byId(call.getArgument(0)).setGatewayAttemptAt(null);
            return 1;
        });
        when(orderRepository.storeGatewayOrder(anyString(), any(), anyString(), any())).thenAnswer(call -> {
            CommerceOrder order = byId(call.getArgument(0));
            if (order.getGatewayOrderId() != null) {
                return 0;
            }
            order.setGatewayVendor(call.getArgument(1));
            order.setGatewayOrderId(call.getArgument(2));
            order.setGatewayKeyId(call.getArgument(3));
            return 1;
        });
        CommerceOrderLine line = new CommerceOrderLine();
        line.setPaymentLogId("log-1");
        when(lineRepository.findByOrderIdOrderByLineNoAsc(anyString())).thenReturn(List.of(line));

        when(writer.write(any(CommerceOrderWriter.NewOrder.class))).thenAnswer(call -> {
            CommerceOrderWriter.NewOrder n = call.getArgument(0);
            CommerceOrder order = new CommerceOrder();
            order.setId("order-" + (stored.size() + 1));
            order.setInstituteId(n.instituteId());
            order.setOrderNumber(n.orderNumber());
            order.setClientRequestId(n.clientRequestId());
            order.setRequestHash(n.requestHash());
            order.setPaymentGroupId("group-" + (stored.size() + 1));
            order.setStatus("PENDING_PAYMENT");
            order.setPaymentStatus("UNPAID");
            order.setCurrency("INR");
            order.setTotal(n.snapshot().getTotal());
            order.setPrimaryPaymentLogId("log-1");
            order.setHoldExpiresAt(new Date(System.currentTimeMillis() + 900_000L));
            stored.add(order);
            return new CommerceOrderWriter.Written(order, List.of(line), "release-token");
        });
        when(gateway.createOrder(eq(INSTITUTE), anyString(), anyLong(), anyString(), anyString(), any()))
                .thenAnswer(call -> new CheckoutGateway.GatewayOrderRef("RAZORPAY", "order_gw_" + call.getArgument(1),
                        "rzp_key", call.getArgument(2), call.getArgument(3)));
    }

    // ------------------------------------------------------------------ fixtures

    private CommerceOrder byId(String id) {
        return stored.stream().filter(o -> o.getId().equals(id)).findFirst().orElseThrow();
    }

    private CartPriceSnapshot snapshot() {
        return CartPriceSnapshot.builder().version(1).currency("INR").paymentMethod("PREPAID")
                .placeOfSupplyState(placeState)
                .lines(List.of(CartPriceSnapshot.Line.builder().lineRef("r1").packageSessionId("ps-a").quantity(1)
                        .unitPrice(new BigDecimal("1000.00")).build()))
                .tax(TaxResult.builder().lines(List.of()).build())
                .total(serverTotal)
                .build();
    }

    private static CheckoutRequest request(String requestId) {
        return CheckoutRequest.builder()
                .clientRequestId(requestId)
                .lines(new ArrayList<>(List.of(CartPriceRequest.Line.builder().variantId("ps-a").quantity(1).build())))
                .expectedTotal(new BigDecimal("1050.00"))
                .customer(CheckoutRequest.Customer.builder().name(" Asha ").phone("+91 98765 43210")
                        .email("Asha@Example.com").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("12 Gandhi Marg").city("Lucknow")
                        .pincode("226001").build())
                .build();
    }

    private static CheckoutException refused(org.junit.jupiter.api.function.Executable call) {
        return assertThrows(CheckoutException.class, call);
    }

    // ------------------------------------------------------------------ placing

    @Test
    void anOrderIsPlacedAndTheGatewayOrderCreatedAfterTheOrderIsWritten() {
        CheckoutDtos.Placed placed = service.placeOrder(INSTITUTE, request("req-12345678"), "10.0.0.1");

        assertEquals("order-1", placed.getOrderId());
        assertEquals("ORD-000007", placed.getOrderNumber());
        assertEquals("PENDING_PAYMENT", placed.getStatus());
        assertEquals(new BigDecimal("1050.00"), placed.getTotal());
        assertFalse(placed.isReplayed());
        assertFalse(placed.isPaymentRetryable());
        assertEquals("order_gw_order-1", placed.getPayment().getGatewayOrderId());
        assertEquals("rzp_key", placed.getPayment().getKeyId());
        assertEquals(105000L, placed.getPayment().getAmountMinor());
        assertEquals("log-1", placed.getHold().getPaymentLogId());
        assertEquals("release-token", placed.getHold().getReleaseToken());
        CommerceOrderAccessTokens.Access access = accessTokens.verify(placed.getOrderAccessToken());
        assertEquals("order-1", access.orderId());
        assertEquals(INSTITUTE, access.instituteId());

        // Remote calls and the counter come before the order transaction; the gateway after it.
        InOrder inOrder = inOrder(botCheck, orderService, buyerResolver, counterService, writer, gateway,
                legacyRepository);
        inOrder.verify(botCheck).verify(INSTITUTE, null, "10.0.0.1");
        inOrder.verify(orderService).priceCart(eq(INSTITUTE), any());
        inOrder.verify(buyerResolver).resolve(INSTITUTE, BuyerIdentity.EITHER, PHONE, "Asha", "asha@example.com",
                false);
        inOrder.verify(counterService).nextNumber(INSTITUTE, "ORD");
        inOrder.verify(writer).write(any());
        inOrder.verify(gateway).createOrder(eq(INSTITUTE), eq("order-1"), eq(105000L), eq("INR"), eq("order-1"),
                any());
        inOrder.verify(legacyRepository).storeGatewayDataOnLogs(eq(List.of("log-1")), eq("group-1"), anyString());
    }

    @Test
    void theCartIsPricedFromTheTypedAddressAndThePricedStateIsTheStateOfTheOrder() {
        CheckoutRequest request = request("req-12345678");
        request.getShippingAddress().setStateCode("27");
        request.setCouponCode(" FEST10 ");
        placeState = "09";

        service.placeOrder(INSTITUTE, request, null);

        ArgumentCaptor<CartPriceRequest> cart = ArgumentCaptor.forClass(CartPriceRequest.class);
        verify(orderService).priceCart(eq(INSTITUTE), cart.capture());
        assertEquals("226001", cart.getValue().getPincode());
        assertEquals("27", cart.getValue().getStateCode());
        assertEquals("PREPAID", cart.getValue().getPaymentMethod());
        assertEquals("FEST10", cart.getValue().getCouponCode());
        assertEquals("asha@example.com", cart.getValue().getEmail());

        ArgumentCaptor<CommerceOrderWriter.NewOrder> written = ArgumentCaptor.forClass(CommerceOrderWriter.NewOrder.class);
        verify(writer).write(written.capture());
        // The pincode decided the state the tax was computed for; the order keeps that one.
        assertEquals("09", written.getValue().shippingAddress().get("state_code"));
        assertEquals("Asha", written.getValue().shippingAddress().get("name"));
        assertEquals(PHONE, written.getValue().shippingAddress().get("phone"));
        assertEquals(PHONE, written.getValue().phone());
        assertEquals(15, written.getValue().holdMinutes());
        assertEquals("user-1", written.getValue().userId());
    }

    @Test
    void theGatewayNotesCarryTheOrderIdAsTheOrderReference() {
        service.placeOrder(INSTITUTE, request("req-12345678"), null);
        ArgumentCaptor<Map<String, String>> notes = ArgumentCaptor.forClass(Map.class);
        verify(gateway).createOrder(any(), any(), anyLong(), any(), any(), notes.capture());
        assertEquals("order-1", notes.getValue().get("orderId"));
        assertEquals(INSTITUTE, notes.getValue().get("instituteId"));
        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(legacyRepository).storeGatewayDataOnLogs(anyCollection(), anyString(), json.capture());
        // What the webhook's log finder matches on, and the gateway answer beside it.
        assertTrue(json.getValue().contains("\"originalRequest\":{\"order_id\":\"order-1\""));
        assertTrue(json.getValue().contains("\"razorpayOrderId\":\"order_gw_order-1\""));
    }

    // ------------------------------------------------------------------ idempotency

    @Test
    void theSameKeyAndTheSameBodyAnswerTheSameOrder() {
        CheckoutDtos.Placed first = service.placeOrder(INSTITUTE, request("req-12345678"), null);
        CheckoutDtos.Placed second = service.placeOrder(INSTITUTE, request("req-12345678"), null);

        assertEquals(first.getOrderId(), second.getOrderId());
        assertEquals(first.getOrderNumber(), second.getOrderNumber());
        assertTrue(second.isReplayed());
        assertEquals(first.getPayment().getGatewayOrderId(), second.getPayment().getGatewayOrderId());
        // The release token is given once.
        assertNull(second.getHold());
        assertEquals(1, stored.size());
        verify(writer, times(1)).write(any());
        verify(gateway, times(1)).createOrder(any(), any(), anyLong(), any(), any(), any());
        verify(buyerResolver, times(1)).resolve(any(), any(), any(), any(), any(), anyBoolean());
        verify(counterService, times(1)).nextNumber(any(), any());
        // A replay creates nothing, so it is not asked for a bot-check token again.
        verify(botCheck, times(1)).verify(any(), any(), any());
        verify(orderService, times(1)).priceCart(any(), any());
    }

    @Test
    void theSameKeyWithAnotherBodyIsA409() {
        service.placeOrder(INSTITUTE, request("req-12345678"), null);

        CheckoutRequest other = request("req-12345678");
        other.getLines().get(0).setQuantity(2);
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, other, null));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals(CheckoutException.IDEMPOTENCY_KEY_REUSED, e.getCode());

        CheckoutRequest otherAddress = request("req-12345678");
        otherAddress.getShippingAddress().setLine1("99 Other Road");
        assertEquals(CheckoutException.IDEMPOTENCY_KEY_REUSED,
                refused(() -> service.placeOrder(INSTITUTE, otherAddress, null)).getCode());

        assertEquals(1, stored.size());
        verify(writer, times(1)).write(any());
    }

    @Test
    void twoRequestsWithOneKeyAtTheSameMomentEndWithOneOrder() {
        // The first look finds nothing; the insert then loses the unique key to the other request.
        CommerceOrder winner = new CommerceOrder();
        winner.setId("order-w");
        winner.setInstituteId(INSTITUTE);
        winner.setOrderNumber("ORD-000006");
        winner.setClientRequestId("req-12345678");
        winner.setStatus("PENDING_PAYMENT");
        winner.setPaymentStatus("UNPAID");
        winner.setCurrency("INR");
        winner.setTotal(new BigDecimal("1050.00"));
        winner.setGatewayOrderId("order_gw_w");
        when(writer.write(any())).thenAnswer(call -> {
            CommerceOrderWriter.NewOrder n = call.getArgument(0);
            winner.setRequestHash(n.requestHash());
            stored.add(winner);
            throw new DataIntegrityViolationException("uq_commerce_order_client_request");
        });

        CheckoutDtos.Placed placed = service.placeOrder(INSTITUTE, request("req-12345678"), null);

        assertEquals("order-w", placed.getOrderId());
        assertTrue(placed.isReplayed());
        assertEquals("order_gw_w", placed.getPayment().getGatewayOrderId());
        verify(gateway, never()).createOrder(any(), any(), anyLong(), any(), any(), any());
    }

    @Test
    void aUniqueKeyFailureThatIsNotTheRequestKeyIsNotSwallowed() {
        when(writer.write(any())).thenThrow(new DataIntegrityViolationException("uq_commerce_order_number"));
        assertThrows(DataIntegrityViolationException.class,
                () -> service.placeOrder(INSTITUTE, request("req-12345678"), null));
    }

    @Test
    void theRequestHashCoversWhatMakesAnOrderAndNotTheTokens() {
        CommerceCheckoutService.Clean a = service.validate(request("req-12345678"));
        CheckoutRequest sameWithTokens = request("req-12345678");
        sameWithTokens.setChallengeToken("turnstile-token");
        sameWithTokens.setPhoneToken("phone-token");
        sameWithTokens.getCustomer().setPhone("9876543210");
        assertEquals(CommerceCheckoutService.requestHash(a),
                CommerceCheckoutService.requestHash(service.validate(sameWithTokens)));

        CheckoutRequest otherTotal = request("req-12345678");
        otherTotal.setExpectedTotal(new BigDecimal("1049.00"));
        assertNotEquals(CommerceCheckoutService.requestHash(a),
                CommerceCheckoutService.requestHash(service.validate(otherTotal)));

        CheckoutRequest otherPhone = request("req-12345678");
        otherPhone.getCustomer().setPhone("9876543211");
        assertNotEquals(CommerceCheckoutService.requestHash(a),
                CommerceCheckoutService.requestHash(service.validate(otherPhone)));
        assertEquals(64, CommerceCheckoutService.requestHash(a).length());
    }

    // ------------------------------------------------------------------ price

    @Test
    void aTotalOtherThanTheOneTheShopperSawIsA409WithTheNewPriceAndNothingIsWritten() {
        serverTotal = new BigDecimal("1100.00");

        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, request("req-12345678"), null));

        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals(CheckoutException.PRICE_CHANGED, e.getCode());
        assertSame(view, e.getDetails().get("price"));
        verifyNoInteractions(writer, buyerResolver, counterService, gateway);
        assertTrue(stored.isEmpty());
    }

    @Test
    void theTotalIsComparedAsANumber() {
        CheckoutRequest request = request("req-12345678");
        request.setExpectedTotal(new BigDecimal("1050"));
        assertNotNull(service.placeOrder(INSTITUTE, request, null).getOrderId());
    }

    @Test
    void aLineThatCanNoLongerBeBoughtIsA409WithThePrice() {
        view = CartPriceDtos.CartPrice.builder().currency("INR")
                .unavailable(List.of(CartPriceDtos.UnavailableLine.builder().lineRef("r1").reason("OUT_OF_STOCK")
                        .build())).build();
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, request("req-12345678"), null));
        assertEquals(CheckoutException.CART_CHANGED, e.getCode());
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertSame(view, e.getDetails().get("price"));
        verifyNoInteractions(writer, buyerResolver, gateway);
    }

    @Test
    void anAddressWhoseStateIsNotKnownIsRefused() {
        placeState = null;
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, request("req-12345678"), null));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verifyNoInteractions(writer);
    }

    @Test
    void aCartTheShopCannotPriceIsRefused() {
        when(orderService.priceCart(eq(INSTITUTE), any())).thenThrow(
                new CartPricingException(CartPricingException.NOT_PRICEABLE, "The shop has no tax setup."));
        assertEquals(HttpStatus.CONFLICT,
                refused(() -> service.placeOrder(INSTITUTE, request("req-12345678"), null)).getStatus());
        org.mockito.Mockito.doThrow(new CartPricingException(CartPricingException.CART_INVALID,
                "A line has no variant.")).when(orderService).priceCart(eq(INSTITUTE), any());
        assertEquals(HttpStatus.BAD_REQUEST,
                refused(() -> service.placeOrder(INSTITUTE, request("req-12345679"), null)).getStatus());
        verifyNoInteractions(writer);
    }

    @Test
    void anOrderWithNothingToPayIsNotPlacedOnline() {
        serverTotal = new BigDecimal("0.00");
        CheckoutRequest request = request("req-12345678");
        request.setExpectedTotal(new BigDecimal("0.00"));
        assertEquals(CheckoutException.NOT_PRICEABLE, refused(() -> service.placeOrder(INSTITUTE, request, null))
                .getCode());
        verifyNoInteractions(writer);
    }

    // ------------------------------------------------------------------ limits and checks

    @Test
    void codIsRefusedInOnePlaceUntilItIsBuilt() {
        CheckoutRequest request = request("req-12345678");
        request.setPaymentMethod("cod");
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, request, null));
        assertEquals(CheckoutException.PAYMENT_METHOD_NOT_AVAILABLE, e.getCode());
        request.setPaymentMethod("WALLET");
        assertEquals(HttpStatus.BAD_REQUEST, refused(() -> service.placeOrder(INSTITUTE, request, null)).getStatus());
        assertEquals("PREPAID", CommerceCheckoutService.paymentMethod(null));
        assertEquals("PREPAID", CommerceCheckoutService.paymentMethod(" prepaid "));
        verifyNoInteractions(orderService, writer);
    }

    @Test
    void aFailedBotCheckStopsTheCheckoutBeforePricing() {
        when(botCheck.verify(eq(INSTITUTE), any(), any())).thenReturn(false);
        CheckoutRequest request = request("req-12345678");
        request.setChallengeToken("bad-token");
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, request, "10.0.0.1"));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals(CheckoutException.BOT_CHECK_FAILED, e.getCode());
        verify(botCheck).verify(INSTITUTE, "bad-token", "10.0.0.1");
        verifyNoInteractions(orderService, writer, buyerResolver, gateway);
    }

    @Test
    void aPhoneWithTooManyUnpaidOrdersIsRefusedUntilItIsVerified() {
        when(orderRepository.countOpenUnpaidByPhone(INSTITUTE, PHONE)).thenReturn(3L);
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, request("req-12345678"), null));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatus());
        assertEquals(CheckoutException.TOO_MANY_OPEN_ORDERS, e.getCode());
        assertEquals(Boolean.TRUE, e.getDetails().get("otp_allows_more"));
        verifyNoInteractions(writer, buyerResolver);

        // A token for another phone does not help.
        CheckoutRequest withToken = request("req-12345679");
        withToken.setPhoneToken("phone-token");
        when(verifiedPhones.phoneOf(INSTITUTE, "phone-token", "CHECKOUT")).thenReturn("919999999999");
        refused(() -> service.placeOrder(INSTITUTE, withToken, null));

        when(verifiedPhones.phoneOf(INSTITUTE, "phone-token", "CHECKOUT")).thenReturn(PHONE);
        assertNotNull(service.placeOrder(INSTITUTE, withToken, null).getOrderId());

        // And the second cap holds for a verified phone too.
        when(orderRepository.countOpenUnpaidByPhone(INSTITUTE, PHONE)).thenReturn(10L);
        CheckoutRequest again = request("req-12345680");
        again.setPhoneToken("phone-token");
        CheckoutException capped = refused(() -> service.placeOrder(INSTITUTE, again, null));
        assertEquals(Boolean.FALSE, capped.getDetails().get("otp_allows_more"));
    }

    @Test
    void anEmailWithTooManyUnpaidOrdersIsRefused() {
        when(orderRepository.countOpenUnpaidByEmail(INSTITUTE, "asha@example.com")).thenReturn(3L);
        assertEquals(CheckoutException.TOO_MANY_OPEN_ORDERS,
                refused(() -> service.placeOrder(INSTITUTE, request("req-12345678"), null)).getCode());
    }

    @Test
    void withNoTokenKeyCheckoutDoesNotStart() {
        CommerceCheckoutService off = new CommerceCheckoutService(orderService, writer, buyerResolver,
                counterService, mock(CommerceStockSettings.class), orderRepository, lineRepository,
                legacyRepository, gateway, new CommerceOrderAccessTokens("", Clock.systemUTC()), botCheck,
                paymentConfirmService, orderPaymentService, rateLimiter, verifiedPhones, sessions, storefrontSettings,
                new ObjectMapper(), mock(PlatformTransactionManager.class));
        CheckoutException e = refused(() -> off.placeOrder(INSTITUTE, request("req-12345678"), null));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        verifyNoInteractions(orderService, writer, gateway);
    }

    // ------------------------------------------------------------------ validation

    @Test
    void theBodyIsCapped() {
        CheckoutRequest tooManyLines = request("req-12345678");
        for (int i = 0; i < CommerceOrderService.MAX_LINES; i++) {
            tooManyLines.getLines().add(CartPriceRequest.Line.builder().variantId("ps-" + i).quantity(1).build());
        }
        assertEquals(HttpStatus.BAD_REQUEST, refused(() -> service.validate(tooManyLines)).getStatus());

        CheckoutRequest longNote = request("req-12345678");
        longNote.setCustomerNote("x".repeat(501));
        refused(() -> service.validate(longNote));

        CheckoutRequest longLine = request("req-12345678");
        longLine.getShippingAddress().setLine1("x".repeat(301));
        refused(() -> service.validate(longLine));

        CheckoutRequest control = request("req-12345678");
        control.getCustomer().setName("As\u0000ha");
        refused(() -> service.validate(control));

        refused(() -> service.validate(null));
        verifyNoInteractions(orderService, writer);
    }

    @Test
    void whatIsMissingOrMalformedIsA400() {
        for (String badId : new String[] {null, "", "short", "has space 12345", "x".repeat(65), "semi;colon123"}) {
            assertEquals(HttpStatus.BAD_REQUEST, refused(() -> service.validate(request(badId))).getStatus());
        }
        CheckoutRequest noLines = request("req-12345678");
        noLines.setLines(List.of());
        refused(() -> service.validate(noLines));

        CheckoutRequest noTotal = request("req-12345678");
        noTotal.setExpectedTotal(null);
        refused(() -> service.validate(noTotal));

        CheckoutRequest threeDecimals = request("req-12345678");
        threeDecimals.setExpectedTotal(new BigDecimal("10.501"));
        refused(() -> service.validate(threeDecimals));

        CheckoutRequest badPhone = request("req-12345678");
        badPhone.getCustomer().setPhone("12345");
        refused(() -> service.validate(badPhone));

        CheckoutRequest badEmail = request("req-12345678");
        badEmail.getCustomer().setEmail("not-an-email");
        refused(() -> service.validate(badEmail));

        // A placeholder address of the shop is not for typing in.
        CheckoutRequest reservedEmail = request("req-12345678");
        reservedEmail.getCustomer().setEmail("b-0123456789abcdef01234567@buyer.invalid");
        refused(() -> service.validate(reservedEmail));

        CheckoutRequest badPin = request("req-12345678");
        badPin.getShippingAddress().setPincode("0226001");
        refused(() -> service.validate(badPin));

        CheckoutRequest badState = request("req-12345678");
        badState.getShippingAddress().setStateCode("XX");
        refused(() -> service.validate(badState));

        CheckoutRequest badGstin = request("req-12345678");
        badGstin.setBuyerGstin("09ABCDE1234F");
        refused(() -> service.validate(badGstin));

        CheckoutRequest noAddress = request("req-12345678");
        noAddress.setShippingAddress(null);
        refused(() -> service.validate(noAddress));

        CheckoutRequest noName = request("req-12345678");
        noName.getCustomer().setName("  ");
        refused(() -> service.validate(noName));
    }

    @Test
    void aValidRequestIsTrimmedAndSpelledAsStored() {
        CheckoutRequest request = request("req-12345678");
        request.getCustomer().setEmail(null);
        CommerceCheckoutService.Clean clean = service.validate(request);
        assertEquals("Asha", clean.name());
        assertEquals(PHONE, clean.phone());
        assertNull(clean.email());
        assertEquals("226001", clean.shippingAddress().get("pincode"));
        assertEquals("12 Gandhi Marg", clean.shippingAddress().get("line1"));
        assertNull(clean.billingAddress());
        assertNull(clean.addressToRemember());
        assertEquals(new BigDecimal("1050.00"), clean.expectedTotal());
    }

    // ------------------------------------------------------------------ gateway

    @Test
    void aFailedGatewayCallLeavesTheOrderWaitingAndARetryCreatesTheGatewayOrder() {
        when(gateway.createOrder(any(), any(), anyLong(), any(), any(), any()))
                .thenThrow(new IllegalStateException("gateway timeout key=secret-like-text"));

        CheckoutDtos.Placed placed = service.placeOrder(INSTITUTE, request("req-12345678"), null);

        assertEquals("PENDING_PAYMENT", placed.getStatus());
        assertNull(placed.getPayment());
        assertTrue(placed.isPaymentRetryable());
        assertNotNull(placed.getOrderAccessToken());
        assertNull(byId("order-1").getGatewayOrderId());
        // The claim was given back, so the retry does not have to wait for it to lapse.
        assertNull(byId("order-1").getGatewayAttemptAt());
        verify(legacyRepository, never()).storeGatewayDataOnLogs(any(), any(), any());

        org.mockito.Mockito.reset(gateway);
        when(gateway.createOrder(eq(INSTITUTE), anyString(), anyLong(), anyString(), anyString(), any()))
                .thenReturn(new CheckoutGateway.GatewayOrderRef("RAZORPAY", "order_gw_2", "rzp_key", 105000L, "INR"));
        CheckoutDtos.Placed retried = service.retryPayment(INSTITUTE, "order-1", placed.getOrderAccessToken());

        assertEquals("order_gw_2", retried.getPayment().getGatewayOrderId());
        assertFalse(retried.isPaymentRetryable());
        assertEquals("order_gw_2", byId("order-1").getGatewayOrderId());
        assertEquals(1, stored.size());
    }

    @Test
    void theGatewayIsNeverAskedTwiceForOneOrder() {
        service.placeOrder(INSTITUTE, request("req-12345678"), null);
        String token = accessTokens.issue(INSTITUTE, "order-1");

        service.retryPayment(INSTITUTE, "order-1", token);
        service.retryPayment(INSTITUTE, "order-1", token);
        service.placeOrder(INSTITUTE, request("req-12345678"), null);

        verify(gateway, times(1)).createOrder(any(), any(), anyLong(), any(), any(), any());
        verify(orderRepository, times(1)).storeGatewayOrder(any(), any(), any(), any());
    }

    @Test
    void whileAnotherCallerTalksToTheGatewayThisOneDoesNot() {
        service.placeOrder(INSTITUTE, request("req-12345678"), null);
        CommerceOrder order = byId("order-1");
        order.setGatewayOrderId(null);
        order.setGatewayAttemptAt(new Date());
        org.mockito.Mockito.clearInvocations(gateway);

        CheckoutDtos.Placed retried = service.retryPayment(INSTITUTE, "order-1", accessTokens.issue(INSTITUTE, "order-1"));

        assertNull(retried.getPayment());
        assertTrue(retried.isPaymentRetryable());
        verifyNoInteractions(gateway);
    }

    @Test
    void aGatewayOrderForAnotherAmountIsNotHandedToTheShopper() {
        when(gateway.createOrder(any(), any(), anyLong(), any(), any(), any()))
                .thenReturn(new CheckoutGateway.GatewayOrderRef("RAZORPAY", "order_gw_x", "rzp_key", 100L, "INR"));
        CheckoutDtos.Placed placed = service.placeOrder(INSTITUTE, request("req-12345678"), null);
        assertNull(placed.getPayment());
        assertNull(byId("order-1").getGatewayOrderId());
        verify(orderRepository, never()).storeGatewayOrder(any(), any(), any(), any());
    }

    @Test
    void aRetryNeedsTheAccessTokenOfThatOrder() {
        service.placeOrder(INSTITUTE, request("req-12345678"), null);
        service.placeOrder(INSTITUTE, request("req-12345679"), null);
        String tokenOfOther = accessTokens.issue(INSTITUTE, "order-2");
        String tokenOfOtherInstitute = accessTokens.issue("inst-2", "order-1");

        assertEquals(HttpStatus.FORBIDDEN,
                refused(() -> service.retryPayment(INSTITUTE, "order-1", tokenOfOther)).getStatus());
        assertEquals(HttpStatus.FORBIDDEN,
                refused(() -> service.retryPayment(INSTITUTE, "order-1", tokenOfOtherInstitute)).getStatus());
        assertEquals(HttpStatus.FORBIDDEN,
                refused(() -> service.retryPayment(INSTITUTE, "order-1", null)).getStatus());
        assertEquals(HttpStatus.FORBIDDEN,
                refused(() -> service.retryPayment(INSTITUTE, "order-1", "v1.x.y")).getStatus());
    }

    @Test
    void anOrderThatIsNotWaitingForPaymentCannotBeRetried() {
        service.placeOrder(INSTITUTE, request("req-12345678"), null);
        byId("order-1").setStatus("CANCELLED");
        CheckoutException e = refused(() -> service.retryPayment(INSTITUTE, "order-1",
                accessTokens.issue(INSTITUTE, "order-1")));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals(CheckoutException.ORDER_NOT_PAYABLE, e.getCode());

        // And the replay of its checkout answers the order as it is, with no payment step.
        CheckoutDtos.Placed replay = service.placeOrder(INSTITUTE, request("req-12345678"), null);
        assertEquals("CANCELLED", replay.getStatus());
        assertNull(replay.getPayment());
        assertFalse(replay.isPaymentRetryable());
    }

    // ------------------------------------------------------------------ review round 4

    @Test
    void anOrderWhoseStockIsNoLongerHeldIsNotOfferedForPayment_theStoredGatewayOrderIsNotHandedOut() {
        CheckoutDtos.Placed placed = service.placeOrder(INSTITUTE, request("req-12345678"), null);
        assertNotNull(placed.getPayment());
        // The shopper gave the stock back (or the time ran out): the payable check closes the
        // order instead of offering it.
        when(orderPaymentService.ensurePayable("order-1")).thenAnswer(call -> {
            byId("order-1").setStatus("CANCELLED");
            return false;
        });

        CheckoutException e = refused(() -> service.retryPayment(INSTITUTE, "order-1", placed.getOrderAccessToken()));

        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals(CheckoutException.ORDER_NOT_PAYABLE, e.getCode());
        // And the replay of the checkout shows the closed order, again with no payment step.
        CheckoutDtos.Placed replay = service.placeOrder(INSTITUTE, request("req-12345678"), null);
        assertEquals("CANCELLED", replay.getStatus());
        assertNull(replay.getPayment());
        assertFalse(replay.isPaymentRetryable());
    }

    @Test
    void whileAPaymentIsInProgressNoPaymentStepIsOffered_soNothingCanBePaidTwice() {
        CheckoutDtos.Placed placed = service.placeOrder(INSTITUTE, request("req-12345678"), null);
        when(paymentConfirmService.paymentInProgress("order-1")).thenReturn(true);
        org.mockito.Mockito.clearInvocations(gateway, orderPaymentService);

        CheckoutDtos.Placed retried = service.retryPayment(INSTITUTE, "order-1", placed.getOrderAccessToken());
        CheckoutDtos.Placed replay = service.placeOrder(INSTITUTE, request("req-12345678"), null);

        for (CheckoutDtos.Placed answer : List.of(retried, replay)) {
            assertEquals("PENDING_PAYMENT", answer.getStatus());
            assertNull(answer.getPayment());
            assertTrue(answer.isPaymentProcessing());
            assertFalse(answer.isPaymentRetryable());
        }
        verifyNoInteractions(gateway, orderPaymentService);
    }

    @Test
    void aClientConfirmationOfAnOrderTheWebhookHasNotPaidYetAnswersProcessing_notPaidAndNotRetryable() {
        service.placeOrder(INSTITUTE, request("req-12345678"), null);
        when(paymentConfirmService.confirmClientPayment(INSTITUTE, "order_gw_order-1", "pay_1", "sig"))
                .thenReturn(new CommercePaymentConfirmService.Result(CommercePaymentConfirmService.Outcome.HANDLED,
                        "order-1", null, 0));

        CheckoutDtos.Placed answer = service.confirmClientPayment(INSTITUTE, "order-1", "order_gw_order-1",
                "pay_1", "sig");

        assertEquals("PENDING_PAYMENT", answer.getStatus());
        assertEquals("UNPAID", answer.getPaymentStatus());
        assertTrue(answer.isPaymentProcessing());
        assertFalse(answer.isPaymentRetryable());
        assertNull(answer.getPayment());
    }

    @Test
    void withNoBotCheckSetUpAtAllCheckoutAnswers503AndNothingIsPricedOrWritten() {
        when(botCheck.notConfigured(INSTITUTE)).thenReturn(true);

        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, request("req-12345678"), "10.0.0.1"));

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertEquals(CheckoutException.NOT_CONFIGURED, e.getCode());
        verifyNoInteractions(orderService, writer, gateway, buyerResolver, rateLimiter);
    }

    @Test
    void checkoutsAndOrdersAreCountedPerNetworkAddressInTheSharedLimiter() {
        service.placeOrder(INSTITUTE, request("req-12345678"), "10.0.0.1");
        service.placeOrder(INSTITUTE, request("req-12345679"), "10.0.0.9", true);

        verify(rateLimiter).allow(INSTITUTE, "checkout-attempt-ip", "10.0.0.1", Duration.ofMinutes(10), 60);
        verify(rateLimiter).allow(INSTITUTE, "checkout-order-ip", "10.0.0.1", Duration.ofMinutes(15), 20);
        // A server places orders for many shoppers from one address.
        verify(rateLimiter).allow(INSTITUTE, "checkout-attempt-ip", "10.0.0.9", Duration.ofMinutes(10), 300);
        verify(rateLimiter).allow(INSTITUTE, "checkout-order-ip", "10.0.0.9", Duration.ofMinutes(15), 100);
    }

    @Test
    void anAddressOverItsLimitPlacesNoOrder_aNewPhoneAndEmailEachTimeDoNotHelp() {
        when(rateLimiter.allow(eq(INSTITUTE), eq("checkout-order-ip"), eq("10.0.0.1"), any(), anyInt()))
                .thenReturn(false);

        for (int i = 0; i < 3; i++) {
            CheckoutRequest request = request("req-1234567" + i);
            request.getCustomer().setEmail("new" + i + "@example.com");
            CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, request, "10.0.0.1"));
            assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatus());
            assertEquals(CheckoutException.RATE_LIMITED, e.getCode());
        }
        verify(writer, never()).write(any());
        verify(counterService, never()).nextNumber(any(), any());

        // The attempt limit stops it even earlier: before pricing and before the bot check.
        when(rateLimiter.allow(eq(INSTITUTE), eq("checkout-attempt-ip"), eq("10.0.0.2"), any(), anyInt()))
                .thenReturn(false);
        org.mockito.Mockito.clearInvocations(orderService, botCheck);
        assertEquals(CheckoutException.RATE_LIMITED,
                refused(() -> service.placeOrder(INSTITUTE, request("req-12345699"), "10.0.0.2")).getCode());
        verify(orderService, never()).priceCart(any(), any());
        verify(botCheck, never()).verify(any(), any(), any());
    }

    @Test
    void aLimiterThatCannotCountPlacesNoOrder() {
        when(rateLimiter.allow(anyString(), anyString(), anyString(), any(), anyInt()))
                .thenThrow(new IllegalStateException("database down"));

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,
                refused(() -> service.placeOrder(INSTITUTE, request("req-12345678"), "10.0.0.1")).getStatus());
        verifyNoInteractions(writer);
    }

    @Test
    void aTypedPhoneIsNotProof_onlyATokenOfAnOtpToThatPhoneMarksTheOrderVerified() {
        ArgumentCaptor<CommerceOrderWriter.NewOrder> written = ArgumentCaptor.forClass(CommerceOrderWriter.NewOrder.class);

        // 1. No token.
        service.placeOrder(INSTITUTE, request("req-12345671"), null);
        // 2. A token that proves another phone.
        when(verifiedPhones.phoneOf(INSTITUTE, "token-of-another-phone", "CHECKOUT")).thenReturn("919000000000");
        CheckoutRequest other = request("req-12345672");
        other.setPhoneToken("token-of-another-phone");
        service.placeOrder(INSTITUTE, other, null);
        // 3. A token that proves this phone.
        when(verifiedPhones.phoneOf(INSTITUTE, "token-of-this-phone", "CHECKOUT")).thenReturn(PHONE);
        CheckoutRequest proved = request("req-12345673");
        proved.setPhoneToken("token-of-this-phone");
        service.placeOrder(INSTITUTE, proved, null);

        verify(writer, times(3)).write(written.capture());
        assertFalse(written.getAllValues().get(0).phoneVerified());
        assertFalse(written.getAllValues().get(1).phoneVerified());
        assertTrue(written.getAllValues().get(2).phoneVerified());
        verify(buyerResolver, times(2)).resolve(INSTITUTE, BuyerIdentity.EITHER, PHONE, "Asha", "asha@example.com",
                false);
        verify(buyerResolver, times(1)).resolve(INSTITUTE, BuyerIdentity.EITHER, PHONE, "Asha", "asha@example.com",
                true);
        // The buyer of a proved phone is its holder; the writer is told so.
        assertFalse(written.getAllValues().get(0).buyerIsHolder());
        assertTrue(written.getAllValues().get(2).buyerIsHolder());
    }

    // ------------------------------------------------------------------ buyer identity (P2)

    private CheckoutRequest withoutEmail(String requestId) {
        CheckoutRequest r = request(requestId);
        r.getCustomer().setEmail(null);
        return r;
    }

    @Test
    void phoneOtpModeWithoutProofIsRefused403BeforeTheBotCheckForEveryKindOfBadToken() {
        mode = BuyerIdentity.PHONE_OTP;
        when(verifiedPhones.phoneOf(INSTITUTE, "other-phone", "CHECKOUT")).thenReturn("919000000000");
        // Expired, forged, other institute or TRACK_ORDER purpose: the adapter answers null for CHECKOUT.
        for (String token : new String[] {null, "other-phone", "expired", "forged", "other-institute",
                "track-order-token"}) {
            CheckoutRequest r = request("req-" + (token == null ? "none0000" : token));
            r.setPhoneToken(token);
            CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, r, "10.0.0.1"));
            assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
            assertEquals(CheckoutException.PHONE_VERIFICATION_REQUIRED, e.getCode());
            assertEquals("phone_token", e.getDetails().get("param"));
            assertEquals("mode", e.getDetails().get("reason"));
        }
        verifyNoInteractions(botCheck, writer, buyerResolver, orderService);
    }

    @Test
    void phoneOtpModeWithAProvedPhonePlacesTheOrderEvenWithoutAnEmail() {
        mode = BuyerIdentity.PHONE_OTP;
        when(verifiedPhones.phoneOf(INSTITUTE, "token-of-this-phone", "CHECKOUT")).thenReturn(PHONE);
        CheckoutRequest r = withoutEmail("req-12345690");
        r.setPhoneToken("token-of-this-phone");

        assertNotNull(service.placeOrder(INSTITUTE, r, null).getOrderId());
        verify(buyerResolver).resolve(INSTITUTE, BuyerIdentity.PHONE_OTP, PHONE, "Asha", null, true);
    }

    @Test
    void aSessionOfTheSamePhoneProvesItForAPrepaidOrder_anotherPhonesSessionDoesNot() {
        mode = BuyerIdentity.PHONE_OTP;
        when(sessions.verify(INSTITUTE, "s1.this")).thenReturn(new CommerceShopperSessions.Session(INSTITUTE, "cust-1",
                PHONE, java.time.Instant.now().plusSeconds(3600)));
        when(sessions.verify(INSTITUTE, "s1.other")).thenReturn(new CommerceShopperSessions.Session(INSTITUTE,
                "cust-2", "919000000000", java.time.Instant.now().plusSeconds(3600)));

        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, withoutEmail("req-12345691"), null, false,
                "s1.other"));
        assertEquals(CheckoutException.PHONE_VERIFICATION_REQUIRED, e.getCode());
        // A bad session is "not proved", never an error of its own.
        when(sessions.verify(INSTITUTE, "s1.bad")).thenThrow(new IllegalStateException("db"));
        assertEquals(CheckoutException.PHONE_VERIFICATION_REQUIRED,
                refused(() -> service.placeOrder(INSTITUTE, withoutEmail("req-12345692"), null, false, "s1.bad"))
                        .getCode());

        assertNotNull(service.placeOrder(INSTITUTE, withoutEmail("req-12345693"), null, false, "s1.this").getOrderId());
        verify(buyerResolver).resolve(INSTITUTE, BuyerIdentity.PHONE_OTP, PHONE, "Asha", null, true);
    }

    @Test
    void eitherWithoutProofOrEmailAsksForTheEmailAndOffersTheOtp_emailModeDoesNotOfferIt() {
        CheckoutException either = refused(() -> service.placeOrder(INSTITUTE, withoutEmail("req-12345694"), null));
        assertEquals(HttpStatus.BAD_REQUEST, either.getStatus());
        assertEquals(CheckoutException.EMAIL_REQUIRED, either.getCode());
        assertEquals("customer.email", either.getDetails().get("param"));
        assertEquals(Boolean.TRUE, either.getDetails().get("otp_allowed"));

        mode = BuyerIdentity.EMAIL;
        when(verifiedPhones.phoneOf(INSTITUTE, "token-of-this-phone", "CHECKOUT")).thenReturn(PHONE);
        CheckoutRequest proved = withoutEmail("req-12345695");
        proved.setPhoneToken("token-of-this-phone");
        CheckoutException email = refused(() -> service.placeOrder(INSTITUTE, proved, null));
        assertEquals(CheckoutException.EMAIL_REQUIRED, email.getCode());
        assertEquals(Boolean.FALSE, email.getDetails().get("otp_allowed"));
        verifyNoInteractions(botCheck, writer, buyerResolver);
    }

    @Test
    void codIsNotPlacedOnlineYet() {
        CheckoutRequest cod = request("req-12345696");
        cod.setPaymentMethod("COD");
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, cod, null));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals(CheckoutException.PAYMENT_METHOD_NOT_AVAILABLE, e.getCode());
        assertEquals("COD_NOT_AVAILABLE", e.getDetails().get("reason"));
        assertFalse(CommerceCheckoutConfig.COD_ONLINE);
    }

    @Test
    void aDuplicateThatIsRefusedInsideTheWriteBecauseItsTwinWonIsAnsweredWithTheTwinsOrder() {
        // The first look finds nothing. Inside the write the twin has already taken the last
        // use of the coupon (or the last piece), which shows here as a refusal.
        CommerceOrder winner = new CommerceOrder();
        winner.setId("order-w");
        winner.setInstituteId(INSTITUTE);
        winner.setOrderNumber("ORD-000006");
        winner.setClientRequestId("req-12345678");
        winner.setStatus("PENDING_PAYMENT");
        winner.setPaymentStatus("UNPAID");
        winner.setCurrency("INR");
        winner.setTotal(new BigDecimal("1050.00"));
        winner.setGatewayOrderId("order_gw_w");
        winner.setRequestHash(CommerceCheckoutService.requestHash(service.validate(request("req-12345678"))));
        when(writer.write(any())).thenAnswer(call -> {
            stored.add(winner);
            throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.COUPON_NOT_AVAILABLE, "gone");
        });

        CheckoutDtos.Placed answer = service.placeOrder(INSTITUTE, request("req-12345678"), null);

        assertEquals("order-w", answer.getOrderId());
        assertTrue(answer.isReplayed());
        assertEquals("order_gw_w", answer.getPayment().getGatewayOrderId());
    }

    @Test
    void aRefusalInsideTheWriteWithNoTwinStaysARefusal() {
        when(writer.write(any())).thenThrow(
                new CheckoutException(HttpStatus.CONFLICT, CheckoutException.COUPON_NOT_AVAILABLE, "gone"));

        assertEquals(CheckoutException.COUPON_NOT_AVAILABLE,
                refused(() -> service.placeOrder(INSTITUTE, request("req-12345678"), null)).getCode());
    }

    @Test
    void whenTheGatewayOrderCannotBeStoredTheClaimGoesBackSoTheShopperCanAskAgainAtOnce() {
        org.mockito.Mockito.doThrow(new IllegalStateException("connection lost")).when(orderRepository)
                .storeGatewayOrder(anyString(), any(), anyString(), any());

        CheckoutDtos.Placed placed = service.placeOrder(INSTITUTE, request("req-12345678"), null);

        assertNull(placed.getPayment());
        assertTrue(placed.isPaymentRetryable());
        assertNull(byId("order-1").getGatewayAttemptAt());
    }

    // ------------------------------------------------------------------ client confirmation

    @Test
    void aClientConfirmationForAnotherOrderIsRefused() {
        service.placeOrder(INSTITUTE, request("req-12345678"), null);
        when(paymentConfirmService.confirmClientPayment(INSTITUTE, "order_gw_other", "pay_1", "sig"))
                .thenReturn(new CommercePaymentConfirmService.Result(CommercePaymentConfirmService.Outcome.HANDLED,
                        "order-9", null, 1));
        when(paymentConfirmService.confirmClientPayment(INSTITUTE, "order_gw_bad", "pay_1", "sig"))
                .thenReturn(new CommercePaymentConfirmService.Result(CommercePaymentConfirmService.Outcome.REFUSED,
                        "order-1", "SIGNATURE_INVALID", 0));
        when(paymentConfirmService.confirmClientPayment(INSTITUTE, "order_gw_order-1", "pay_1", "sig"))
                .thenReturn(new CommercePaymentConfirmService.Result(CommercePaymentConfirmService.Outcome.HANDLED,
                        "order-1", null, 1));

        assertEquals(CheckoutException.PAYMENT_NOT_CONFIRMED, refused(() -> service.confirmClientPayment(INSTITUTE,
                "order-1", "order_gw_other", "pay_1", "sig")).getCode());
        assertEquals(CheckoutException.PAYMENT_NOT_CONFIRMED, refused(() -> service.confirmClientPayment(INSTITUTE,
                "order-1", "order_gw_bad", "pay_1", "sig")).getCode());

        byId("order-1").setStatus("CONFIRMED");
        byId("order-1").setPaymentStatus("PAID");
        CheckoutDtos.Placed confirmed = service.confirmClientPayment(INSTITUTE, "order-1", "order_gw_order-1",
                "pay_1", "sig");
        assertEquals("CONFIRMED", confirmed.getStatus());
        assertEquals("PAID", confirmed.getPaymentStatus());
        assertNull(confirmed.getPayment());
    }
}
