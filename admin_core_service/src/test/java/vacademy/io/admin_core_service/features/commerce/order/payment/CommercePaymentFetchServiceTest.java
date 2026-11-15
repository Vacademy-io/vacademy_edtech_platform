package vacademy.io.admin_core_service.features.commerce.order.payment;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentFetchService.Kind;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentFetchService.Outcome;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGateway.GatewayPayment;

import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * One fetch of one gateway order: what each payment status leads to, the schedule written
 * afterwards, and that no credential reaches a log line. The gateway is a mock.
 */
class CommercePaymentFetchServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String GW = "order_gw_1";
    private static final Date NOW = Date.from(Instant.parse("2026-11-15T10:00:00Z"));
    /** What the claim writes as the next fetch, should the run never write its result. */
    private static final Date CLAIM = new Date(NOW.getTime() + 3 * 60_000L);

    private CommercePaymentGateway gateway;
    private CommercePaymentConfirmService confirmService;
    private CommerceGatewayOrderRepository gatewayOrders;
    private CommercePaymentFetchService service;
    private CommerceGatewayOrder row;
    private ListAppender<ILoggingEvent> logs;

    @BeforeEach
    void setUp() {
        gateway = mock(CommercePaymentGateway.class);
        confirmService = mock(CommercePaymentConfirmService.class);
        gatewayOrders = mock(CommerceGatewayOrderRepository.class);
        service = new CommercePaymentFetchService(gateway, confirmService, gatewayOrders);
        row = new CommerceGatewayOrder();
        row.setId("gw-row-1");
        row.setInstituteId(INSTITUTE);
        row.setGatewayOrderId(GW);
        row.setCommerceOrderId("order-1");
        row.setAmountMinor(105000L);
        row.setCurrency("INR");
        when(gatewayOrders.findById("gw-row-1")).thenReturn(Optional.of(row));
        when(gatewayOrders.claimFetch(eq("gw-row-1"), eq(NOW), eq(CLAIM),
                eq(new Date(NOW.getTime() - 3 * 60_000L)))).thenReturn(1);
        logs = new ListAppender<>();
        logs.start();
        ((Logger) LoggerFactory.getLogger(CommercePaymentFetchService.class)).addAppender(logs);
    }

    @AfterEach
    void tearDown() {
        ((Logger) LoggerFactory.getLogger(CommercePaymentFetchService.class)).detachAppender(logs);
        TransactionSynchronizationManager.setActualTransactionActive(false);
    }

    private static CommercePaymentGuard.DueFetch due(String status, int fetchCount, Date holdExpiresAt,
                                                     Date finalFetchedAt, Date cancelledAt) {
        return new CommercePaymentGuard.DueFetch("gw-row-1", INSTITUTE, GW, "order-1", status, fetchCount, null,
                finalFetchedAt, holdExpiresAt, cancelledAt, new Date(NOW.getTime() - 300_000L));
    }

    private static CommercePaymentGuard.DueFetch open(int fetchCount) {
        return due("PENDING_PAYMENT", fetchCount, new Date(NOW.getTime() + 600_000L), null, null);
    }

    private static GatewayPayment payment(String id, String orderId, String status, long amount, long secondsAgo) {
        return new GatewayPayment(id, orderId, status, amount, "INR", NOW.toInstant().minusSeconds(secondsAgo));
    }

    private static CommercePaymentConfirmService.Result handled(int claimed, String note) {
        return new CommercePaymentConfirmService.Result(CommercePaymentConfirmService.Outcome.HANDLED, "order-1", note,
                claimed);
    }

    private long count(String text) {
        return logs.list.stream().filter(e -> e.getFormattedMessage().contains(text)).count();
    }

    @Test
    void aCapturedPaymentIsConfirmedThroughTheWebhooksPathWithTheGatewayAmount() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(payment("pay_1", GW, "captured", 105000L, 60)));
        when(confirmService.confirmPaid(row, INSTITUTE, 105000L, "INR", "pay_1", "fetch")).thenReturn(handled(2, null));

        assertEquals(Outcome.CONFIRMED, service.fetch(open(0), Kind.OPEN, NOW));

        verify(confirmService).confirmPaid(row, INSTITUTE, 105000L, "INR", "pay_1", "fetch");
        assertEquals(1, count("COMMERCE_ALERT lost_webhook_recovered institute=inst-1 order=order-1 "
                + "gateway_order=order_gw_1 payment=pay_1"));
        verify(gatewayOrders).recordFetch(eq("gw-row-1"), eq(NOW), eq(new Date(NOW.getTime() + 120_000L)), isNull(),
                eq(CLAIM));
    }

    @Test
    void aCaptureTheWebhookAlreadySettledIsAReplayWithNoAlert() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(payment("pay_1", GW, "captured", 105000L, 60)));
        when(confirmService.confirmPaid(any(), any(), any(), any(), any(), any())).thenReturn(handled(0, null));

        assertEquals(Outcome.REPLAY, service.fetch(open(1), Kind.OPEN, NOW));
        assertEquals(0, count("lost_webhook_recovered"));
    }

    @Test
    void anAuthorisedPaymentIsMarkedAuthorised() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(payment("pay_1", GW, "authorized", 105000L, 60)));
        when(confirmService.markAuthorized(row, INSTITUTE, "pay_1", "fetch")).thenReturn(handled(0, null));

        assertEquals(Outcome.AUTHORIZED, service.fetch(open(0), Kind.OPEN, NOW));
        verify(confirmService, never()).confirmPaid(any(), any(), any(), any(), any(), any());
    }

    @Test
    void createdAndFailedPaymentsWriteNothing() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(payment("pay_1", GW, "created", 105000L, 60),
                payment("pay_2", GW, "failed", 105000L, 30)));

        assertEquals(Outcome.FAILED_ONLY, service.fetch(open(0), Kind.OPEN, NOW));
        verifyNoInteractions(confirmService);

        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of());
        assertEquals(Outcome.NO_PAYMENT, service.fetch(open(1), Kind.OPEN, NOW));
        verifyNoInteractions(confirmService);
    }

    @Test
    void aPaymentOfAnotherGatewayOrderIsIgnored() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(
                payment("pay_9", "order_gw_other", "captured", 105000L, 60)));

        assertEquals(Outcome.NO_PAYMENT, service.fetch(open(0), Kind.OPEN, NOW));
        verifyNoInteractions(confirmService);
    }

    @Test
    void twoCapturedPaymentsGoOldestFirst_theSecondReachesTheDuplicatePath() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(
                payment("pay_new", GW, "captured", 105000L, 10), payment("pay_old", GW, "captured", 105000L, 90)));
        when(confirmService.confirmPaid(row, INSTITUTE, 105000L, "INR", "pay_old", "fetch")).thenReturn(handled(2, null));
        when(confirmService.confirmPaid(row, INSTITUTE, 105000L, "INR", "pay_new", "fetch")).thenReturn(
                handled(0, CommercePaymentConfirmService.NOTE_DUPLICATE_PAYMENT));

        assertEquals(Outcome.CONFIRMED, service.fetch(open(0), Kind.OPEN, NOW));

        var order = inOrder(confirmService);
        order.verify(confirmService).confirmPaid(row, INSTITUTE, 105000L, "INR", "pay_old", "fetch");
        order.verify(confirmService).confirmPaid(row, INSTITUTE, 105000L, "INR", "pay_new", "fetch");
    }

    @Test
    void anAmountMismatchIsRefusedThereAndNothingIsPaid() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(payment("pay_1", GW, "captured", 100L, 60)));
        when(confirmService.confirmPaid(row, INSTITUTE, 100L, "INR", "pay_1", "fetch")).thenReturn(
                new CommercePaymentConfirmService.Result(CommercePaymentConfirmService.Outcome.REFUSED, "order-1",
                        CommercePaymentConfirmService.REASON_AMOUNT_MISMATCH, 0));

        assertEquals(Outcome.REFUSED, service.fetch(open(0), Kind.OPEN, NOW));
        assertEquals(0, count("lost_webhook_recovered"));
    }

    @Test
    void aGatewayErrorIsAskedAgainInAMinute_andTheFinalFetchIsNotMarkedDone() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenThrow(new CommercePaymentGatewayException(
                CommercePaymentGatewayException.UNAVAILABLE, "The payment gateway did not answer"));
        CommercePaymentGuard.DueFetch inGrace = due("PENDING_PAYMENT", 3, new Date(NOW.getTime() - 40_000L), null,
                null);

        assertEquals(Outcome.ERROR, service.fetch(inGrace, Kind.FINAL, NOW));

        verify(gatewayOrders).recordFetchError("gw-row-1", NOW, new Date(NOW.getTime() + 60_000L), CLAIM);
        verify(gatewayOrders, never()).recordFetch(anyString(), any(), any(), any(), any());
        verifyNoInteractions(confirmService);
        assertEquals(1, count("COMMERCE_FETCH gateway_error institute=inst-1 gateway_order=order_gw_1 "
                + "kind=GATEWAY_UNAVAILABLE errors_in_a_row=1"));
    }

    @Test
    void errorsInARowWaitLongerUpToAnHour_exceptTheFinalFetch() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenThrow(new CommercePaymentGatewayException(
                CommercePaymentGatewayException.UNAVAILABLE, "The payment gateway did not answer"));
        CommercePaymentGuard.DueFetch failing = new CommercePaymentGuard.DueFetch("gw-row-1", INSTITUTE, GW,
                "order-1", "PENDING_PAYMENT", 2, NOW, null, new Date(NOW.getTime() + 600_000L), null,
                new Date(NOW.getTime() - 300_000L), 3);

        assertEquals(Outcome.ERROR, service.fetch(failing, Kind.OPEN, NOW));

        verify(gatewayOrders).recordFetchError("gw-row-1", NOW, new Date(NOW.getTime() + 8 * 60_000L), CLAIM);
        long[] minutes = {1, 2, 4, 8, 16, 32, 60, 60, 60};
        for (int before = 0; before < minutes.length; before++) {
            assertEquals(new Date(NOW.getTime() + minutes[before] * 60_000L),
                    CommercePaymentFetchService.nextAfterError(Kind.OPEN, before, NOW), "errors before " + before);
            assertEquals(new Date(NOW.getTime() + minutes[before] * 60_000L),
                    CommercePaymentFetchService.nextAfterError(Kind.LATE, before, NOW));
            assertEquals(new Date(NOW.getTime() + 60_000L),
                    CommercePaymentFetchService.nextAfterError(Kind.FINAL, before, NOW));
        }
    }

    @Test
    void aCapturedPaymentWithoutAmountOrCurrencyIsNotConfirmed() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(
                new GatewayPayment("pay_1", GW, "captured", -1L, "INR", NOW.toInstant()),
                new GatewayPayment("pay_2", GW, "captured", 105000L, null, NOW.toInstant())));

        assertEquals(Outcome.REFUSED, service.fetch(open(0), Kind.OPEN, NOW));

        verifyNoInteractions(confirmService);
        assertEquals(2, count("COMMERCE_ALERT payment fetch found a captured payment without amount or currency"));
        assertEquals(0, count("lost_webhook_recovered"));
    }

    @Test
    void aFinalFetchTwoMinutesPastTheHoldTimeEndsTheFinalStageAndStartsTheLateSchedule() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of());
        CommercePaymentGuard.DueFetch pastGrace = due("PENDING_PAYMENT", 3, new Date(NOW.getTime() - 120_000L), null,
                null);

        assertEquals(Outcome.NO_PAYMENT, service.fetch(pastGrace, Kind.FINAL, NOW));

        verify(gatewayOrders).recordFetch("gw-row-1", NOW, new Date(NOW.getTime() + 15 * 60_000L), NOW, CLAIM);
    }

    @Test
    void inTheGraceAFinalFetchWithoutACaptureIsNotMarkedDone_andIsAskedAgainNextMinute() {
        CommercePaymentGuard.DueFetch inGrace = due("PENDING_PAYMENT", 3, new Date(NOW.getTime() - 40_000L), null,
                null);
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of());
        assertEquals(Outcome.NO_PAYMENT, service.fetch(inGrace, Kind.FINAL, NOW));

        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(payment("pay_1", GW, "authorized", 105000L, 5)));
        when(confirmService.markAuthorized(row, INSTITUTE, "pay_1", "fetch")).thenReturn(handled(0, null));
        assertEquals(Outcome.AUTHORIZED, service.fetch(inGrace, Kind.FINAL, NOW));

        verify(gatewayOrders, org.mockito.Mockito.times(2)).recordFetch("gw-row-1", NOW,
                new Date(NOW.getTime() + 60_000L), null, CLAIM);
        verify(gatewayOrders, never()).recordFetch(anyString(), any(), any(), eq(NOW), any());
    }

    @Test
    void aCaptureFoundInTheGraceEndsTheFinalStage() {
        CommercePaymentGuard.DueFetch inGrace = due("PENDING_PAYMENT", 3, new Date(NOW.getTime() - 40_000L), null,
                null);
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(payment("pay_1", GW, "captured", 105000L, 20)));
        when(confirmService.confirmPaid(row, INSTITUTE, 105000L, "INR", "pay_1", "fetch")).thenReturn(handled(2, null));

        assertEquals(Outcome.CONFIRMED, service.fetch(inGrace, Kind.FINAL, NOW));

        verify(gatewayOrders).recordFetch("gw-row-1", NOW, new Date(NOW.getTime() + 15 * 60_000L), NOW, CLAIM);
    }

    @Test
    void theFinalStageEndsOnASettledOrRefusedPaymentOrTwoMinutesPastTheHoldTime() {
        Date hold = new Date(NOW.getTime() - 60_000L);
        assertTrue(CommercePaymentFetchService.finalStageOver(Outcome.CONFIRMED, hold, NOW));
        assertTrue(CommercePaymentFetchService.finalStageOver(Outcome.REPLAY, hold, NOW));
        assertTrue(CommercePaymentFetchService.finalStageOver(Outcome.REFUSED, hold, NOW));
        assertFalse(CommercePaymentFetchService.finalStageOver(Outcome.NO_PAYMENT, hold, NOW));
        assertFalse(CommercePaymentFetchService.finalStageOver(Outcome.AUTHORIZED, hold, NOW));
        assertFalse(CommercePaymentFetchService.finalStageOver(Outcome.FAILED_ONLY, hold, NOW));
        assertTrue(CommercePaymentFetchService.finalStageOver(Outcome.NO_PAYMENT,
                new Date(NOW.getTime() - 120_000L), NOW));
    }

    @Test
    void aCapturedPaymentThatWasPartlyRefundedIsNotConfirmed() {
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(new GatewayPayment("pay_1", GW, "captured",
                105000L, "INR", NOW.toInstant(), 5000L, "partial")));

        assertEquals(Outcome.REFUSED, service.fetch(due("CANCELLED", 1, null, NOW, NOW), Kind.LATE, NOW));

        verifyNoInteractions(confirmService);
        assertEquals(1, count("COMMERCE_ALERT payment fetch found a captured payment that was partly refunded "
                + "institute=inst-1 order=order-1 gateway_order=order_gw_1 payment=pay_1 refunded=5000"));
        assertEquals(0, count("lost_webhook_recovered"));

        // A refund status alone is enough.
        when(gateway.fetchPayments(INSTITUTE, GW)).thenReturn(List.of(new GatewayPayment("pay_1", GW, "captured",
                105000L, "INR", NOW.toInstant(), 0L, "partial")));
        assertEquals(Outcome.REFUSED, service.fetch(open(0), Kind.OPEN, NOW));
        verifyNoInteractions(confirmService);
    }

    @Test
    void aRowAnotherRunHasIsLeftAlone() {
        when(gatewayOrders.claimFetch(anyString(), any(), any(), any())).thenReturn(0);

        assertEquals(Outcome.BUSY, service.fetch(open(0), Kind.OPEN, NOW));

        verifyNoInteractions(gateway, confirmService);
        verify(gatewayOrders, never()).recordFetch(anyString(), any(), any(), any(), any());
        verify(gatewayOrders, never()).recordFetchError(anyString(), any(), any(), any());
    }

    @Test
    void aClaimThatCannotBeWrittenAsksNothing() {
        when(gatewayOrders.claimFetch(anyString(), any(), any(), any())).thenThrow(new IllegalStateException("db"));

        assertEquals(Outcome.ERROR, service.fetch(open(0), Kind.OPEN, NOW));

        verifyNoInteractions(gateway, confirmService);
    }

    @Test
    void noCredentialReachesALogLine() {
        String secret = "rzp-secret-value-xyz";
        when(gateway.fetchPayments(INSTITUTE, GW)).thenThrow(new IllegalStateException("401 for key " + secret));

        service.fetch(open(0), Kind.OPEN, NOW);

        assertFalse(logs.list.isEmpty());
        for (ILoggingEvent event : logs.list) {
            assertFalse(event.getFormattedMessage().contains(secret), event.getFormattedMessage());
            assertNull(event.getThrowableProxy(), "no exception (and its message) is attached");
        }
    }

    @Test
    void itRefusesToRunInATransaction() {
        TransactionSynchronizationManager.setActualTransactionActive(true);
        assertThrows(IllegalStateException.class, () -> service.fetch(open(0), Kind.OPEN, NOW));
        verifyNoInteractions(gateway);
    }

    // ------------------------------------------------------------------ schedule

    @Test
    void theOpenScheduleIs2_3_5_5_10MinutesThenEvery30WhileTheOrderIsOpen() {
        long[] minutes = {2, 3, 5, 5, 10, 30, 30, 30};
        for (int count = 0; count < minutes.length; count++) {
            assertEquals(new Date(NOW.getTime() + minutes[count] * 60_000L),
                    CommercePaymentFetchService.nextAfterSuccess(Kind.OPEN, count, NOW, null));
        }
        assertEquals(new Date(NOW.getTime() + 30 * 60_000L),
                CommercePaymentFetchService.nextAfterSuccess(Kind.OPEN, 47, NOW, null), "a 24 h hold");
    }

    @Test
    void theLateScheduleIsAboutOneSixAndTwentyFourHoursApartThenNone() {
        Date cancelled = new Date(NOW.getTime() - Duration.ofMinutes(15).toMillis());
        assertEquals(new Date(NOW.getTime() + Duration.ofHours(1).toMillis()),
                CommercePaymentFetchService.nextAfterSuccess(Kind.LATE, 3, NOW, cancelled));
        Date later = new Date(cancelled.getTime() + Duration.ofMinutes(75).toMillis());
        assertEquals(new Date(later.getTime() + Duration.ofHours(6).toMillis()),
                CommercePaymentFetchService.nextAfterSuccess(Kind.LATE, 4, later, cancelled));
        Date later2 = new Date(cancelled.getTime() + Duration.ofMinutes(435).toMillis());
        assertEquals(new Date(later2.getTime() + Duration.ofHours(24).toMillis()),
                CommercePaymentFetchService.nextAfterSuccess(Kind.LATE, 5, later2, cancelled));
        Date last = new Date(cancelled.getTime() + Duration.ofMinutes(1875).toMillis());
        assertNull(CommercePaymentFetchService.nextAfterSuccess(Kind.LATE, 6, last, cancelled));
    }

    @Test
    void theFinalFetchStartsAfterTheHoldTime_andWinsOverTheOpenOne() {
        Duration after = Duration.ofSeconds(30);
        assertEquals(Kind.FINAL, CommercePaymentFetchService.kindOf(
                due("PENDING_PAYMENT", 2, new Date(NOW.getTime() - 31_000L), null, null), NOW, after));
        assertEquals(Kind.OPEN, CommercePaymentFetchService.kindOf(
                due("PENDING_PAYMENT", 2, new Date(NOW.getTime() - 29_000L), null, null), NOW, after));
        assertEquals(Kind.OPEN, CommercePaymentFetchService.kindOf(
                due("PENDING_PAYMENT", 2, new Date(NOW.getTime() + 30_000L), null, null), NOW, after),
                "before the hold time no final fetch");
        assertEquals(Kind.OPEN, CommercePaymentFetchService.kindOf(
                due("PENDING_PAYMENT", 2, new Date(NOW.getTime() - 300_000L), NOW, null), NOW, after),
                "once the final stage is over it is not repeated");
        assertEquals(Kind.LATE, CommercePaymentFetchService.kindOf(due("CANCELLED", 2, null, NOW, NOW), NOW, after));
        assertEquals(after, CommercePaymentFetchJob.FINAL_AFTER_HOLD);
        verify(gatewayOrders, never()).recordFetch(anyString(), any(), any(), any(), any());
    }
}
