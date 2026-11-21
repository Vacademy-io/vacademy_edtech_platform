package vacademy.io.admin_core_service.features.commerce.order.payment;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService.Outcome;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService.Result;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceRefundHook;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGuard.OrderFacts;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceFactory;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceStrategy;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.enums.PaymentGateway;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * A payment pays a shop order only when the gateway order, the institute and the amount agree
 * with the rows; a replay is safe; a failed confirm step is left for the next delivery.
 */
class CommercePaymentConfirmServiceTest {

    private CommerceGatewayOrderRepository gatewayOrders;
    private CommercePaymentGuard guard;
    private CommerceOrderPaymentPort orders;
    private PaymentLogService paymentLogService;
    private InstitutePaymentGatewayMappingService gatewayMappings;
    private PaymentServiceFactory factory;
    private PaymentServiceStrategy razorpay;
    private CommerceRefundHook refundHook;
    private CommercePaymentConfirmService service;
    private CommerceGatewayOrder row;

    @BeforeEach
    void setUp() {
        gatewayOrders = mock(CommerceGatewayOrderRepository.class);
        guard = mock(CommercePaymentGuard.class);
        orders = mock(CommerceOrderPaymentPort.class);
        paymentLogService = mock(PaymentLogService.class);
        gatewayMappings = mock(InstitutePaymentGatewayMappingService.class);
        factory = mock(PaymentServiceFactory.class);
        razorpay = mock(PaymentServiceStrategy.class);
        when(factory.getStrategy(PaymentGateway.RAZORPAY)).thenReturn(razorpay);
        refundHook = mock(CommerceRefundHook.class);
        service = new CommercePaymentConfirmService(gatewayOrders, guard, orders, paymentLogService,
                gatewayMappings, factory, refundHook, mock(PlatformTransactionManager.class));

        row = new CommerceGatewayOrder();
        row.setId("row-1");
        row.setInstituteId("inst-1");
        row.setCommerceOrderId("order-1");
        row.setVendor("RAZORPAY");
        row.setGatewayOrderId("order_rzp1");
        row.setAmountMinor(49900L);
        row.setCurrency("INR");

        order("PENDING_PAYMENT", "499.00");
        when(guard.logIdsOfGroup("group-1")).thenReturn(List.of("log-a", "log-b"));
        when(paymentLogService.markCommerceLogsPaid(any())).thenReturn(List.of("log-a", "log-b"));
    }

    private void order(String status, String total) {
        when(guard.order("order-1")).thenReturn(Optional.of(new OrderFacts("order-1", "inst-1", "group-1",
                status, new BigDecimal(total), "INR", "UNPAID")));
    }

    @Test
    void aMatchingCaptureClaimsTheLogsAndConfirmsTheOrder() {
        Result result = service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_1", "webhook");

        assertEquals(Outcome.HANDLED, result.outcome());
        assertEquals("order-1", result.commerceOrderId());
        assertEquals(2, result.claimedLogs());
        verify(paymentLogService).markCommerceLogsPaid(List.of("log-a", "log-b"));
        // The gateway order that paid is marked in the claim, with the payment that paid.
        verify(gatewayOrders).markPaying(eq("row-1"), eq("pay_1"), any());
        verify(orders).ensurePaidOrderConfirmed("order-1");
        verifyNoInteractions(refundHook);
    }

    // ── A second captured payment for a paid order (M-1) ─────────────────────

    private CommerceGatewayOrder paying(String rowId, String paymentId) {
        CommerceGatewayOrder paid = new CommerceGatewayOrder();
        paid.setId(rowId);
        paid.setInstituteId("inst-1");
        paid.setCommerceOrderId("order-1");
        paid.setGatewayOrderId("order_rzp_other");
        paid.setStatus("PAID");
        paid.setPaying(true);
        paid.setGatewayPaymentId(paymentId);
        return paid;
    }

    @Test
    void aSecondPaymentOnAnotherGatewayOrderOfAPaidOrderIsRecordedForARefund_notCalledAReplay() {
        when(paymentLogService.markCommerceLogsPaid(any())).thenReturn(List.of());
        when(gatewayOrders.findFirstByCommerceOrderIdAndPayingTrue("order-1"))
                .thenReturn(Optional.of(paying("row-other", "pay_first")));
        when(guard.orderNumber("order-1")).thenReturn("ORD-000007");

        Result result = service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_second", "webhook");

        assertEquals(Outcome.HANDLED, result.outcome());
        assertEquals(CommercePaymentConfirmService.NOTE_DUPLICATE_PAYMENT, result.reason());
        verify(refundHook).refundDuplicatePayment("inst-1", "order-1", "ORD-000007", "order_rzp1", "pay_second",
                new BigDecimal("499.00"), "INR");
        // Its own gateway order shows the capture.
        verify(gatewayOrders).moveUnlessPaid(eq("row-1"), eq("PAID"), eq("pay_second"), any());
        verify(gatewayOrders, never()).markPaying(anyString(), any(), any());
    }

    @Test
    void aSecondPaymentOnTheSameGatewayOrderIsRecordedToo() {
        when(paymentLogService.markCommerceLogsPaid(any())).thenReturn(List.of());
        when(gatewayOrders.findFirstByCommerceOrderIdAndPayingTrue("order-1"))
                .thenReturn(Optional.of(paying("row-1", "pay_first")));

        service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_second", "webhook");

        verify(refundHook).refundDuplicatePayment(eq("inst-1"), eq("order-1"), any(), eq("order_rzp1"),
                eq("pay_second"), eq(new BigDecimal("499.00")), eq("INR"));
    }

    @Test
    void theSamePaymentDeliveredAgainIsAReplay_andSoIsAnEventWithoutAPaymentId() {
        when(paymentLogService.markCommerceLogsPaid(any())).thenReturn(List.of());
        when(gatewayOrders.findFirstByCommerceOrderIdAndPayingTrue("order-1"))
                .thenReturn(Optional.of(paying("row-1", "pay_first")));

        assertEquals(null, service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_first", "webhook").reason());
        assertEquals(null, service.confirmPaid(row, "inst-1", 49900L, "INR", null, "webhook").reason());

        verifyNoInteractions(refundHook);
    }

    @Test
    void aReplayOfThePaymentThatPaidIsNotFlaggedWhenAnotherGatewayOrderWasPaidLater() {
        // Order paid by pay_first on row-1; a second payment later paid row-2 (already recorded).
        // The webhook of pay_first is then delivered again.
        when(paymentLogService.markCommerceLogsPaid(any())).thenReturn(List.of());
        when(gatewayOrders.findFirstByCommerceOrderIdAndPayingTrue("order-1"))
                .thenReturn(Optional.of(paying("row-1", "pay_first")));

        service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_first", "webhook");

        verifyNoInteractions(refundHook);
    }

    @Test
    void logsThatWerePaidByNoGatewayOrderAreAReplay() {
        when(paymentLogService.markCommerceLogsPaid(any())).thenReturn(List.of());
        when(gatewayOrders.findFirstByCommerceOrderIdAndPayingTrue("order-1")).thenReturn(Optional.empty());

        service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_1", "webhook");

        verifyNoInteractions(refundHook);
        verify(gatewayOrders).moveUnlessPaid(eq("row-1"), eq("PAID"), eq("pay_1"), any());
    }

    @Test
    void anAmountThatDiffersFromTheGatewayOrderIsRefusedAndNothingIsWritten() {
        Result result = service.confirmPaid(row, "inst-1", 100L, "INR", "pay_1", "webhook");

        assertTrue(result.refused());
        assertEquals(CommercePaymentConfirmService.REASON_AMOUNT_MISMATCH, result.reason());
        verifyNoInteractions(paymentLogService, orders);
        verify(gatewayOrders, never()).moveUnlessPaid(anyString(), anyString(), any(), any());
    }

    @Test
    void anotherCurrencyIsRefused() {
        assertTrue(service.confirmPaid(row, "inst-1", 49900L, "USD", "pay_1", "webhook").refused());
        verifyNoInteractions(paymentLogService, orders);
    }

    @Test
    void anOrderTotalThatDiffersFromTheGatewayOrderIsRefused() {
        order("PENDING_PAYMENT", "999.00"); // the order is dearer than what the gateway order charged

        Result result = service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_1", "webhook");

        assertEquals(CommercePaymentConfirmService.REASON_AMOUNT_MISMATCH, result.reason());
        verifyNoInteractions(paymentLogService, orders);
    }

    @Test
    void aGatewayOrderOfAnotherInstituteIsRefused() {
        Result result = service.confirmPaid(row, "inst-2", 49900L, "INR", "pay_1", "webhook");

        assertEquals(CommercePaymentConfirmService.REASON_INSTITUTE_MISMATCH, result.reason());
        verifyNoInteractions(paymentLogService, orders);
    }

    @Test
    void aGatewayOrderWhoseOrderIsGoneIsRefused() {
        when(guard.order("order-1")).thenReturn(Optional.empty());

        assertEquals(CommercePaymentConfirmService.REASON_ORDER_NOT_FOUND,
                service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_1", "webhook").reason());
        verifyNoInteractions(paymentLogService, orders);
    }

    @Test
    void aReplayClaimsNothingButStillAsksTheOrderToConfirm() {
        when(paymentLogService.markCommerceLogsPaid(any())).thenReturn(List.of());

        Result result = service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_1", "webhook");

        assertEquals(Outcome.HANDLED, result.outcome());
        assertEquals(0, result.claimedLogs());
        // Once a log is PAID a replay runs no side effect of its own, so every delivery asks.
        verify(orders).ensurePaidOrderConfirmed("order-1");
    }

    @Test
    void anOrderThatLeftPendingPaymentIsMarkedSettled() {
        when(guard.order("order-1"))
                .thenReturn(Optional.of(new OrderFacts("order-1", "inst-1", "group-1", "PENDING_PAYMENT",
                        new BigDecimal("499.00"), "INR", "UNPAID")))
                .thenReturn(Optional.of(new OrderFacts("order-1", "inst-1", "group-1", "PENDING_PAYMENT",
                        new BigDecimal("499.00"), "INR", "UNPAID")))
                .thenReturn(Optional.of(new OrderFacts("order-1", "inst-1", "group-1", "CONFIRMED",
                        new BigDecimal("499.00"), "INR", "PAID")));

        service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_1", "webhook");

        verify(gatewayOrders).settle(eq("order-1"), any());
    }

    @Test
    void aConfirmStepThatFailsDoesNotFailThePaymentAndLeavesTheOrderForTheJob() {
        doThrow(new IllegalStateException("database down")).when(orders).ensurePaidOrderConfirmed("order-1");

        Result result = service.confirmPaid(row, "inst-1", 49900L, "INR", "pay_1", "webhook");

        assertEquals(Outcome.HANDLED, result.outcome()); // the logs are PAID; the gateway is not asked to retry
        verify(gatewayOrders, never()).settle(anyString(), any());
        assertFalse(service.ensureConfirmed("order-1"));
    }

    @Test
    void anOrderStillPendingAfterTheConfirmCallIsNotSettled() {
        assertFalse(service.ensureConfirmed("order-1"));
        verify(gatewayOrders, never()).settle(anyString(), any());
    }

    @Test
    void aFailedAttemptMarksTheLogsFailedAndNeverTouchesTheOrder() {
        when(paymentLogService.markCommerceLogsFailed(any())).thenReturn(List.of("log-a", "log-b"));

        Result result = service.markFailed(row, "inst-1", "pay_1", "webhook");

        assertEquals(Outcome.HANDLED, result.outcome());
        verify(paymentLogService).markCommerceLogsFailed(List.of("log-a", "log-b"));
        verify(gatewayOrders).moveUnlessPaid(eq("row-1"), eq("FAILED"), eq("pay_1"), any());
        verifyNoInteractions(orders); // no cancel, no hold release
    }

    @Test
    void anAuthorisationOnlyMovesTheGatewayRow() {
        service.markAuthorized(row, "inst-1", "pay_1", "webhook");

        verify(gatewayOrders).moveUnlessPaid(eq("row-1"), eq("AUTHORIZED"), eq("pay_1"), any());
        verifyNoInteractions(paymentLogService, orders);
    }

    // ── Client confirmation ──────────────────────────────────────────────────

    @Test
    void aClientConfirmationProvesAnAuthorisationOnly_nothingIsMarkedPaid() {
        when(gatewayOrders.findByVendorAndGatewayOrderId("RAZORPAY", "order_rzp1")).thenReturn(Optional.of(row));
        when(gatewayMappings.findInstitutePaymentGatewaySpecifData("RAZORPAY", "inst-1"))
                .thenReturn(Map.of("apiKey", "key", "publishableKey", "secret"));
        when(razorpay.verifyClientPaymentConfirmation(any(), any())).thenReturn("order_rzp1");

        Result result = service.confirmClientPayment("inst-1", "order_rzp1", "pay_1", "sig");

        assertEquals(Outcome.HANDLED, result.outcome());
        assertEquals("order-1", result.commerceOrderId());
        assertEquals(0, result.claimedLogs());
        // No log is claimed PAID on a signature that carries no amount and proves no capture.
        verify(paymentLogService, never()).markCommerceLogsPaid(any());
        verify(gatewayOrders, never()).markPaying(anyString(), any(), any());
        // The gateway order is AUTHORIZED: the shopper's release call keeps the stock meanwhile.
        verify(gatewayOrders).moveUnlessPaid(eq("row-1"), eq("AUTHORIZED"), eq("pay_1"), any());
        // An order the webhook has paid already is confirmed if its confirm step had failed.
        verify(orders).ensurePaidOrderConfirmed("order-1");
        // And the gateway is asked about it 30 seconds later, in case the webhook is lost.
        org.mockito.ArgumentCaptor<java.util.Date> at = org.mockito.ArgumentCaptor.forClass(java.util.Date.class);
        verify(gatewayOrders).fetchSoon(eq("row-1"), at.capture());
        long inSeconds = (at.getValue().getTime() - System.currentTimeMillis()) / 1000L;
        assertTrue(inSeconds >= 25 && inSeconds <= 30, "fetch in about 30 s, was " + inSeconds);
    }

    @Test
    void aRefusedClientConfirmationSchedulesNoFetch() {
        when(gatewayOrders.findByVendorAndGatewayOrderId("RAZORPAY", "order_rzp1")).thenReturn(Optional.of(row));
        when(gatewayMappings.findInstitutePaymentGatewaySpecifData("RAZORPAY", "inst-1")).thenReturn(Map.of());
        when(razorpay.verifyClientPaymentConfirmation(any(), any()))
                .thenThrow(new VacademyException("Razorpay payment signature verification failed"));

        service.confirmClientPayment("inst-1", "order_rzp1", "pay_1", "forged");

        verify(gatewayOrders, never()).fetchSoon(anyString(), any());
    }

    @Test
    void aPaymentIsInProgressWhileAnAuthorisationIsFresh() {
        when(gatewayOrders.countAuthorizedSince(eq("order-1"), any())).thenReturn(1L, 0L);

        assertTrue(service.paymentInProgress("order-1"));
        assertFalse(service.paymentInProgress("order-1"));
        assertFalse(service.paymentInProgress(null));
    }

    @Test
    void aClientConfirmationWithABadSignatureIsRefused() {
        when(gatewayOrders.findByVendorAndGatewayOrderId("RAZORPAY", "order_rzp1")).thenReturn(Optional.of(row));
        when(gatewayMappings.findInstitutePaymentGatewaySpecifData("RAZORPAY", "inst-1")).thenReturn(Map.of());
        when(razorpay.verifyClientPaymentConfirmation(any(), any()))
                .thenThrow(new VacademyException("Razorpay payment signature verification failed"));

        Result result = service.confirmClientPayment("inst-1", "order_rzp1", "pay_1", "forged");

        assertEquals(CommercePaymentConfirmService.REASON_SIGNATURE_INVALID, result.reason());
        verifyNoInteractions(paymentLogService, orders);
    }

    @Test
    void aClientConfirmationForAnUnknownOrAnotherInstitutesGatewayOrderIsRefusedAlike() {
        when(gatewayOrders.findByVendorAndGatewayOrderId("RAZORPAY", "order_x")).thenReturn(Optional.empty());
        when(gatewayOrders.findByVendorAndGatewayOrderId("RAZORPAY", "order_rzp1")).thenReturn(Optional.of(row));

        Result unknown = service.confirmClientPayment("inst-1", "order_x", "pay_1", "sig");
        Result foreign = service.confirmClientPayment("inst-2", "order_rzp1", "pay_1", "sig");

        assertEquals(unknown.reason(), foreign.reason());
        assertTrue(unknown.refused() && foreign.refused());
        verifyNoInteractions(paymentLogService, orders, razorpay);
    }

    @Test
    void theOrderTotalIsConvertedExactly() {
        assertEquals(49900L, CommercePaymentConfirmService.toMinor(new BigDecimal("499.00"), "INR"));
        assertEquals(1L, CommercePaymentConfirmService.toMinor(new BigDecimal("0.01"), "INR"));
        assertEquals(-1L, CommercePaymentConfirmService.toMinor(new BigDecimal("499.005"), "INR"));
        assertEquals(-1L, CommercePaymentConfirmService.toMinor(null, "INR"));
    }
}
