package vacademy.io.admin_core_service.features.commerce.order.checkout;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodAvailability;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodPlacementRules;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceBotCheck;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceRateLimiter;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;

import java.math.BigDecimal;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
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
 * Cash on delivery at checkout (WP-31 steps 1 to 9): the switch, the phone proof read before
 * anything and spent only inside the write, the COD price, the limits per phone (early and under
 * the lock), the staff-confirmation amount, the hash, the replay and the answer without a payment
 * step. Every refusal creates nothing. The gateway is never asked.
 */
class CommerceCheckoutServiceCodTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "919876543210";
    private static final String TOKEN = "v1.phone.token";

    private CommerceOrderService orderService;
    private CommerceOrderWriter writer;
    private CommerceBuyerResolver buyerResolver;
    private CommerceOrderRepository orderRepository;
    private CheckoutGateway gateway;
    private CommerceBotCheck botCheck;
    private CommerceOrderPaymentService orderPaymentService;
    private VerifiedPhones verifiedPhones;
    private CommerceShopperSessions sessions;
    private CommerceStorefrontSettings storefrontSettings;
    private CommerceCustomerRepository customerRepository;
    private ApplicationEventPublisher publisher;

    private boolean placementOn = true;
    private boolean shopCod = true;
    private CommerceCheckoutService service;

    private final List<CommerceOrder> stored = new ArrayList<>();
    private String snapshotMethod = "COD";
    private BigDecimal serverTotal = new BigDecimal("1090.00");
    private String cartCodReason = null;

    @BeforeEach
    void setUp() {
        orderService = mock(CommerceOrderService.class);
        writer = mock(CommerceOrderWriter.class);
        buyerResolver = mock(CommerceBuyerResolver.class);
        CommerceCounterService counterService = mock(CommerceCounterService.class);
        CommerceStockSettings stockSettings = mock(CommerceStockSettings.class);
        orderRepository = mock(CommerceOrderRepository.class);
        gateway = mock(CheckoutGateway.class);
        botCheck = mock(CommerceBotCheck.class);
        orderPaymentService = mock(CommerceOrderPaymentService.class);
        CommerceRateLimiter rateLimiter = mock(CommerceRateLimiter.class);
        verifiedPhones = mock(VerifiedPhones.class);
        sessions = mock(CommerceShopperSessions.class);
        storefrontSettings = mock(CommerceStorefrontSettings.class);
        customerRepository = mock(CommerceCustomerRepository.class);
        publisher = mock(ApplicationEventPublisher.class);
        when(rateLimiter.allow(anyString(), anyString(), anyString(), any(), anyInt())).thenReturn(true);
        when(storefrontSettings.read(INSTITUTE)).thenAnswer(call -> {
            StorefrontSettings d = StorefrontSettings.defaults();
            return new StorefrontSettings(d.baseLocale(), d.lowStockThreshold(), d.leadMediaTag(), d.priceBands(),
                    d.dispatchPromise(), new StorefrontSettings.Cod(shopCod, new BigDecimal("5000.00"),
                    new BigDecimal("3000.00"), Set.of("190001"), 2, 2, 48), d.pricingRulesJson(),
                    d.maxOrderQuantity(), d.mediaTags(), BuyerIdentity.EITHER, d.otpInstituteHourlyCap());
        });
        when(orderService.priceCart(eq(INSTITUTE), any(CartPriceRequest.class))).thenAnswer(call ->
                new CommerceOrderService.CartPrice(snapshot(), CartPriceDtos.CartPrice.builder().currency("INR")
                        .unavailable(List.of()).cod(CartPriceDtos.Cod.builder().eligible(cartCodReason == null)
                                .reason(cartCodReason).build()).build()));
        when(botCheck.verify(eq(INSTITUTE), any(), any())).thenReturn(true);
        when(buyerResolver.resolve(eq(INSTITUTE), any(), eq(PHONE), anyString(), any(), anyBoolean()))
                .thenAnswer(call -> new CommerceBuyerResolver.Buyer("user-1", call.getArgument(5)));
        when(counterService.nextNumber(INSTITUTE, "ORD")).thenReturn("ORD-000007");
        when(stockSettings.holdMinutes(INSTITUTE)).thenReturn(15);
        when(verifiedPhones.phoneOf(INSTITUTE, TOKEN, "CHECKOUT")).thenReturn(PHONE);
        when(verifiedPhones.spendForCod(INSTITUTE, TOKEN, PHONE)).thenReturn(true);
        when(customerRepository.lockCodRefusalsByPhone(INSTITUTE, PHONE)).thenReturn(0);
        when(orderRepository.findByInstituteIdAndClientRequestId(eq(INSTITUTE), anyString())).thenAnswer(call ->
                stored.stream().filter(o -> o.getClientRequestId().equals(call.getArgument(1))).findFirst());
        when(writer.write(any(CommerceOrderWriter.NewOrder.class), any(CommerceOrderWriter.CodPlacement.class)))
                .thenAnswer(call -> {
                    CommerceOrderWriter.NewOrder n = call.getArgument(0);
                    CommerceOrderWriter.CodPlacement cod = call.getArgument(1);
                    CommerceOrder order = new CommerceOrder();
                    order.setId("order-" + (stored.size() + 1));
                    order.setInstituteId(n.instituteId());
                    order.setOrderNumber(n.orderNumber());
                    order.setClientRequestId(n.clientRequestId());
                    order.setRequestHash(n.requestHash());
                    order.setStatus(cod.staffConfirmation() ? "COD_PENDING_CONFIRMATION" : "CONFIRMED");
                    order.setPaymentMethod("COD");
                    order.setPaymentStatus("UNPAID");
                    order.setCurrency("INR");
                    order.setTotal(n.snapshot().getTotal());
                    stored.add(order);
                    return new CommerceOrderWriter.Written(order, List.of(), null);
                });
        build(counterService, stockSettings, rateLimiter);
    }

    private void build(CommerceCounterService counterService, CommerceStockSettings stockSettings,
                       CommerceRateLimiter rateLimiter) {
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        service = new CommerceCheckoutService(orderService, writer, buyerResolver, counterService, stockSettings,
                orderRepository, mock(CommerceOrderLineRepository.class), mock(CommerceOrderLegacyRepository.class),
                gateway, new CommerceOrderAccessTokens("unit-test-signing-key", Clock.systemUTC()), botCheck,
                mock(CommercePaymentConfirmService.class), orderPaymentService, rateLimiter, verifiedPhones, sessions,
                storefrontSettings, new ObjectMapper(), tm, new CommerceCodAvailability(placementOn),
                new CommerceCodPlacementRules(verifiedPhones, customerRepository, tm),
                new CommerceOrderEvents(publisher));
    }

    private void rebuild() {
        CommerceCounterService counterService = mock(CommerceCounterService.class);
        when(counterService.nextNumber(INSTITUTE, "ORD")).thenReturn("ORD-000007");
        CommerceStockSettings stockSettings = mock(CommerceStockSettings.class);
        when(stockSettings.holdMinutes(INSTITUTE)).thenReturn(15);
        CommerceRateLimiter rateLimiter = mock(CommerceRateLimiter.class);
        when(rateLimiter.allow(anyString(), anyString(), anyString(), any(), anyInt())).thenReturn(true);
        build(counterService, stockSettings, rateLimiter);
    }

    private CartPriceSnapshot snapshot() {
        return CartPriceSnapshot.builder().version(1).currency("INR").paymentMethod(snapshotMethod)
                .placeOfSupplyState("09")
                .lines(List.of(CartPriceSnapshot.Line.builder().lineRef("r1").packageSessionId("ps-a").quantity(1)
                        .unitPrice(new BigDecimal("1000.00")).build()))
                .tax(TaxResult.builder().lines(List.of()).build())
                .total(serverTotal)
                .build();
    }

    private static CheckoutRequest cod(String requestId) {
        return CheckoutRequest.builder()
                .clientRequestId(requestId)
                .paymentMethod("COD")
                .phoneToken(TOKEN)
                .lines(new ArrayList<>(List.of(CartPriceRequest.Line.builder().variantId("ps-a").quantity(1).build())))
                .expectedTotal(new BigDecimal("1090.00"))
                .customer(CheckoutRequest.Customer.builder().name("Asha").phone("+91 98765 43210").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("12 Gandhi Marg").city("Lucknow")
                        .pincode("226001").build())
                .build();
    }

    private static CheckoutException refused(org.junit.jupiter.api.function.Executable call) {
        return assertThrows(CheckoutException.class, call);
    }

    /** Nothing was written and no token was spent. */
    private void nothingWritten() {
        verify(writer, never()).write(any());
        verify(writer, never()).write(any(), any());
        verify(verifiedPhones, never()).spendForCod(anyString(), anyString(), anyString());
        verify(customerRepository, never()).insertIfAbsent(anyString(), anyString(), anyString());
        verify(customerRepository, never()).lockCodRefusalsByPhone(anyString(), anyString());
        verifyNoInteractions(gateway);
    }

    // ------------------------------------------------------------------ step 1: the switch

    @Test
    void withThePlacementSwitchOffCodIsRefusedBeforeAnythingElse() {
        placementOn = false;
        rebuild();
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, cod("req-cod-0001"), null));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals(CheckoutException.PAYMENT_METHOD_NOT_AVAILABLE, e.getCode());
        assertEquals("COD_NOT_AVAILABLE", e.getDetails().get("reason"));
        verifyNoInteractions(orderService, verifiedPhones, botCheck, buyerResolver, orderRepository);
        nothingWritten();
    }

    @Test
    void aShopThatHasNotSwitchedCodOnIsRefusedTheSameWay() {
        shopCod = false;
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, cod("req-cod-0002"), null));
        assertEquals("COD_NOT_AVAILABLE", e.getDetails().get("reason"));
        verifyNoInteractions(orderService, verifiedPhones, botCheck);
        nothingWritten();
    }

    // ------------------------------------------------------------------ step 4: the phone

    @Test
    void aCodRequestWithoutAVerifiedPhoneCreatesNothing() {
        CheckoutRequest noToken = cod("req-cod-0003");
        noToken.setPhoneToken(null);
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, noToken, null));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals(CheckoutException.PHONE_VERIFICATION_REQUIRED, e.getCode());
        assertEquals("phone_token", e.getDetails().get("param"));
        assertEquals("cod", e.getDetails().get("reason"));
        verifyNoInteractions(orderService, botCheck, buyerResolver);
        nothingWritten();

        // A token of another phone, of another purpose or a forged one proves nothing either.
        when(verifiedPhones.phoneOf(INSTITUTE, "other-phone", "CHECKOUT")).thenReturn("919999999999");
        CheckoutRequest other = cod("req-cod-0004");
        other.setPhoneToken("other-phone");
        assertEquals("cod", refused(() -> service.placeOrder(INSTITUTE, other, null)).getDetails().get("reason"));
        CheckoutRequest forged = cod("req-cod-0005");
        forged.setPhoneToken("forged");
        assertEquals(HttpStatus.FORBIDDEN, refused(() -> service.placeOrder(INSTITUTE, forged, null)).getStatus());
        verifyNoInteractions(orderService, botCheck);
        nothingWritten();
    }

    @Test
    void aShopperSessionOfThePhoneDoesNotCountForCod() {
        CheckoutRequest noToken = cod("req-cod-0006");
        noToken.setPhoneToken(null);
        when(sessions.verify(INSTITUTE, "session-token")).thenReturn(
                new CommerceShopperSessions.Session(INSTITUTE, "cust-1", PHONE, java.time.Instant.now().plusSeconds(60)));
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, noToken, null, false, "session-token"));
        assertEquals(CheckoutException.PHONE_VERIFICATION_REQUIRED, e.getCode());
        verifyNoInteractions(sessions);
        nothingWritten();
    }

    @Test
    void aTokenOfPurposeCodIsAcceptedToo() {
        when(verifiedPhones.phoneOf(INSTITUTE, TOKEN, "CHECKOUT")).thenReturn(null);
        when(verifiedPhones.phoneOf(INSTITUTE, TOKEN, "COD")).thenReturn(PHONE);
        assertEquals("CONFIRMED", service.placeOrder(INSTITUTE, cod("req-cod-0007"), null).getStatus());
    }

    @Test
    void theTokenIsReadFirstAndSpentOnlyInsideTheWriteBeforeTheOrderIsWritten() {
        CheckoutDtos.Placed placed = service.placeOrder(INSTITUTE, cod("req-cod-0008"), "10.0.0.1");

        InOrder order = inOrder(verifiedPhones, botCheck, orderService, buyerResolver, customerRepository, writer);
        order.verify(verifiedPhones).phoneOf(INSTITUTE, TOKEN, "CHECKOUT");
        order.verify(botCheck).verify(eq(INSTITUTE), any(), eq("10.0.0.1"));
        order.verify(orderService).priceCart(eq(INSTITUTE), any(CartPriceRequest.class));
        order.verify(customerRepository).countOpenCodOrders(INSTITUTE, PHONE);
        order.verify(buyerResolver).resolve(eq(INSTITUTE), any(), eq(PHONE), anyString(), any(), eq(true));
        order.verify(verifiedPhones).spendForCod(INSTITUTE, TOKEN, PHONE);
        order.verify(customerRepository).insertIfAbsent(anyString(), eq(INSTITUTE), eq(PHONE));
        order.verify(customerRepository).lockCodRefusalsByPhone(INSTITUTE, PHONE);
        order.verify(customerRepository).countOpenCodOrders(INSTITUTE, PHONE);
        order.verify(writer).write(any(CommerceOrderWriter.NewOrder.class), any(CommerceOrderWriter.CodPlacement.class));
        verify(verifiedPhones, times(1)).spendForCod(anyString(), anyString(), anyString());
        assertEquals("CONFIRMED", placed.getStatus());
    }

    @Test
    void aSpentTokenStopsTheOrderInsideTheWrite() {
        when(verifiedPhones.spendForCod(INSTITUTE, TOKEN, PHONE)).thenReturn(false);
        CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, cod("req-cod-0009"), null));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("cod", e.getDetails().get("reason"));
        verify(writer, never()).write(any(), any());
        verify(customerRepository, never()).insertIfAbsent(anyString(), anyString(), anyString());
        assertTrue(stored.isEmpty());
    }

    // ------------------------------------------------------------------ step 6: the price

    @Test
    void aCartThatDoesNotQualifyForCodIsRefusedWithTheCartsReason() {
        for (String reason : List.of("ORDER_ABOVE_COD_LIMIT", "PINCODE_BLOCKED", "PINCODE_INVALID", "COD_DISABLED")) {
            snapshotMethod = "PREPAID";
            cartCodReason = reason;
            CheckoutException e = refused(() -> service.placeOrder(INSTITUTE, cod("req-cod-" + reason), null));
            assertEquals(HttpStatus.CONFLICT, e.getStatus());
            assertEquals(CheckoutException.PAYMENT_METHOD_NOT_AVAILABLE, e.getCode());
            assertEquals(reason, e.getDetails().get("reason"));
        }
        nothingWritten();
    }

    @Test
    void theCartIsPricedForCodAndTheExpectedTotalIsTheCodTotal() {
        service.placeOrder(INSTITUTE, cod("req-cod-0010"), null);
        ArgumentCaptor<CartPriceRequest> cart = ArgumentCaptor.forClass(CartPriceRequest.class);
        verify(orderService).priceCart(eq(INSTITUTE), cart.capture());
        assertEquals("COD", cart.getValue().getPaymentMethod());
        assertEquals("226001", cart.getValue().getPincode());

        // The prepaid total (without the COD charge) is not the total of a COD order.
        CheckoutRequest prepaidTotal = cod("req-cod-0011");
        prepaidTotal.setExpectedTotal(new BigDecimal("1050.00"));
        assertEquals(CheckoutException.PRICE_CHANGED,
                refused(() -> service.placeOrder(INSTITUTE, prepaidTotal, null)).getCode());
        verify(writer, times(1)).write(any(), any());
    }

    // ------------------------------------------------------------------ step 7: the limits

    @Test
    void thePhonesOpenCodOrdersAndRefusalsAreCheckedEarlyWithoutSpendingTheToken() {
        when(customerRepository.countOpenCodOrders(INSTITUTE, PHONE)).thenReturn(2L);
        CheckoutException open = refused(() -> service.placeOrder(INSTITUTE, cod("req-cod-0012"), null));
        assertEquals(CheckoutException.PAYMENT_METHOD_NOT_AVAILABLE, open.getCode());
        assertEquals("OPEN_COD_ORDERS", open.getDetails().get("reason"));

        when(customerRepository.countOpenCodOrders(INSTITUTE, PHONE)).thenReturn(1L);
        when(customerRepository.findCodRefusalsByPhone(INSTITUTE, PHONE)).thenReturn(2);
        CheckoutException refusals = refused(() -> service.placeOrder(INSTITUTE, cod("req-cod-0013"), null));
        assertEquals("COD_REFUSALS", refusals.getDetails().get("reason"));
        verifyNoInteractions(buyerResolver);
        nothingWritten();
    }

    @Test
    void theLimitsAreCheckedAgainUnderTheLockOfTheCustomerRow() {
        // Free when first read; a twin order of the phone committed before the lock was taken.
        when(customerRepository.countOpenCodOrders(INSTITUTE, PHONE)).thenReturn(1L, 2L);
        CheckoutException open = refused(() -> service.placeOrder(INSTITUTE, cod("req-cod-0014"), null));
        assertEquals("OPEN_COD_ORDERS", open.getDetails().get("reason"));
        verify(customerRepository).lockCodRefusalsByPhone(INSTITUTE, PHONE);
        verify(writer, never()).write(any(), any());

        when(customerRepository.countOpenCodOrders(INSTITUTE, PHONE)).thenReturn(0L);
        when(customerRepository.lockCodRefusalsByPhone(INSTITUTE, PHONE)).thenReturn(2);
        assertEquals("COD_REFUSALS",
                refused(() -> service.placeOrder(INSTITUTE, cod("req-cod-0015"), null)).getDetails().get("reason"));
        verify(writer, never()).write(any(), any());
    }

    // ------------------------------------------------------------------ step 9 and the answer

    @Test
    void aCodOrderIsAnsweredWithoutAPaymentStepAndAnnouncedAfterTheWrite() {
        CheckoutDtos.Placed placed = service.placeOrder(INSTITUTE, cod("req-cod-0016"), null);

        assertEquals("CONFIRMED", placed.getStatus());
        assertNull(placed.getPayment());
        assertNull(placed.getHold());
        assertFalse(placed.isPaymentRetryable());
        assertFalse(placed.isPaymentProcessing());
        assertFalse(placed.isReplayed());
        verifyNoInteractions(gateway, orderPaymentService);

        ArgumentCaptor<CommerceOrderWriter.NewOrder> n = ArgumentCaptor.forClass(CommerceOrderWriter.NewOrder.class);
        ArgumentCaptor<CommerceOrderWriter.CodPlacement> c =
                ArgumentCaptor.forClass(CommerceOrderWriter.CodPlacement.class);
        verify(writer).write(n.capture(), c.capture());
        assertTrue(n.getValue().phoneVerified());
        assertFalse(c.getValue().staffConfirmation(), "1090 is not above the 3000 confirmation amount");
        ArgumentCaptor<Object> event = ArgumentCaptor.forClass(Object.class);
        verify(publisher).publishEvent(event.capture());
        assertEquals(CommerceOrderEvents.ORDER_CONFIRMED, ((CommerceOrderEvents.OrderEvent) event.getValue()).type());
    }

    @Test
    void aCodOrderAboveTheConfirmationAmountWaitsForAStaffCall() {
        serverTotal = new BigDecimal("3280.00");
        CheckoutRequest big = cod("req-cod-0017");
        big.setExpectedTotal(serverTotal);
        long before = System.currentTimeMillis();
        CheckoutDtos.Placed placed = service.placeOrder(INSTITUTE, big, null);

        assertEquals("COD_PENDING_CONFIRMATION", placed.getStatus());
        ArgumentCaptor<CommerceOrderWriter.CodPlacement> c =
                ArgumentCaptor.forClass(CommerceOrderWriter.CodPlacement.class);
        verify(writer).write(any(), c.capture());
        assertTrue(c.getValue().staffConfirmation());
        long hours = (c.getValue().confirmDueAt().getTime() - before) / 3_600_000L;
        assertTrue(hours >= 47 && hours <= 48, "due in cod.confirmWithinHours (48)");
        ArgumentCaptor<Object> event = ArgumentCaptor.forClass(Object.class);
        verify(publisher).publishEvent(event.capture());
        assertEquals(CommerceOrderEvents.COD_CONFIRMATION_NEEDED,
                ((CommerceOrderEvents.OrderEvent) event.getValue()).type());
    }

    @Test
    void theStaffConfirmationTermsFollowTheShopsAmountAndWindow() {
        StorefrontSettings.Cod cod = new StorefrontSettings.Cod(true, new BigDecimal("5000.00"),
                new BigDecimal("3000.00"), Set.of(), 2, 2, 6);
        Date now = new Date(1_000_000_000L);
        assertFalse(CommerceCodPlacementRules.terms(cod, new BigDecimal("3000.00"), now).staffConfirmation(),
                "at the amount: no call");
        CommerceCodPlacementRules.Terms above = CommerceCodPlacementRules.terms(cod, new BigDecimal("3000.01"), now);
        assertTrue(above.staffConfirmation());
        assertEquals(now.getTime() + 6 * 3_600_000L, above.confirmDueAt().getTime());
    }

    // ------------------------------------------------------------------ hash and replay

    @Test
    void theHashOfACodRequestDiffersAndThePrepaidHashIsUnchanged() {
        CheckoutRequest asCod = cod("req-cod-0018");
        CheckoutRequest asPrepaid = cod("req-cod-0018");
        asPrepaid.setPaymentMethod("PREPAID");
        CheckoutRequest noMethod = cod("req-cod-0018");
        noMethod.setPaymentMethod(null);
        String codHash = CommerceCheckoutService.requestHash(service.validate(asCod));
        String prepaidHash = CommerceCheckoutService.requestHash(service.validate(asPrepaid));
        assertNotEquals(codHash, prepaidHash);
        assertEquals(prepaidHash, CommerceCheckoutService.requestHash(service.validate(noMethod)));
        // The tokens are not part of it.
        CheckoutRequest otherToken = cod("req-cod-0018");
        otherToken.setPhoneToken("another");
        assertEquals(codHash, CommerceCheckoutService.requestHash(service.validate(otherToken)));
    }

    @Test
    void aRepeatOfACodRequestAnswersItsOrderWithoutAPaymentStepOrASecondSpend() {
        CheckoutDtos.Placed first = service.placeOrder(INSTITUTE, cod("req-cod-0019"), null);
        CheckoutDtos.Placed again = service.placeOrder(INSTITUTE, cod("req-cod-0019"), null);

        assertEquals(first.getOrderId(), again.getOrderId());
        assertTrue(again.isReplayed());
        assertNull(again.getPayment());
        assertFalse(again.isPaymentRetryable());
        verify(writer, times(1)).write(any(), any());
        verify(verifiedPhones, times(1)).spendForCod(anyString(), anyString(), anyString());
        verifyNoInteractions(gateway, orderPaymentService);
        verify(gateway, never()).createOrder(anyString(), anyString(), anyLong(), anyString(), anyString(), any());

        // The same key with another body is refused.
        CheckoutRequest changed = cod("req-cod-0019");
        changed.setPaymentMethod("PREPAID");
        assertEquals(CheckoutException.IDEMPOTENCY_KEY_REUSED,
                refused(() -> service.placeOrder(INSTITUTE, changed, null)).getCode());
    }
}
