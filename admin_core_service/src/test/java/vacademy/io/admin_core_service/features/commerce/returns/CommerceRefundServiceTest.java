package vacademy.io.admin_core_service.features.commerce.returns;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGateway;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGatewayException;
import vacademy.io.admin_core_service.features.commerce.returns.dto.RefundDtos;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.ORDER;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.PAYMENT;

/**
 * Refunds and the order's refund ledger: the caps (open due, return, paid, payment), the rules of
 * each method, the keys, manual payouts and cancels, an adopted gateway refund, the exception rows,
 * and the books and the buyer told after the commit.
 */
class CommerceRefundServiceTest {

    private RefundFixture f;

    @BeforeEach
    void setUp() {
        f = new RefundFixture();
    }

    private RefundDtos.CreateRefundRequest.CreateRefundRequestBuilder body(String amount, String method) {
        return RefundDtos.CreateRefundRequest.builder().clientRequestId("refund-key-1").orderId(ORDER)
                .amount(new BigDecimal(amount)).method(method).reason("goods came back");
    }

    private RefundDtos.RefundView create(RefundDtos.CreateRefundRequest.CreateRefundRequestBuilder b) {
        return f.service.create(RefundFixture.manager(), INST, b.build());
    }

    @Test
    void aRefundAboveTheOpenDueIsRefusedAndWithinItIsCommitted() {
        ConflictException above = assertThrows(ConflictException.class, () -> create(body("600.01", "CASH")));
        assertTrue(above.getMessage().startsWith("REFUND_ABOVE_DUE"), above.getMessage());
        assertTrue(f.refunds.isEmpty());

        RefundDtos.RefundView cash = create(body("600.00", "CASH"));
        assertEquals("PROCESSED", cash.getStatus());
        assertEquals(0, new BigDecimal("600.00").compareTo(f.order.getRefundCommitted()));
        assertEquals(0, new BigDecimal("600.00").compareTo(f.order.getAmountRefunded()));
        CommerceRefund row = f.refunds.get(0);
        assertEquals("REQ:refund-key-1", row.getIdempotencyKey());
        assertEquals("STAFF", row.getSource());
        assertEquals("ORDER", row.getKind());
        assertEquals(f.today, row.getPaidOn());
        // A second refund now finds nothing open.
        ConflictException none = assertThrows(ConflictException.class, () -> create(body("0.01", "CASH")
                .clientRequestId("refund-key-2")));
        assertTrue(none.getMessage().startsWith("REFUND_ABOVE_DUE"));
    }

    @Test
    void thePaidCapHoldsEvenWhenTheDueWereAbovePaid() {
        f.order.setRefundDue(new BigDecimal("1000.00"));
        f.order.setAmountPaid(new BigDecimal("800.00"));
        ConflictException e = assertThrows(ConflictException.class,
                () -> CommerceRefundService.requireWithinDue(f.order, new BigDecimal("900.00")));
        assertTrue(e.getMessage().startsWith("REFUND_ABOVE_PAID"), e.getMessage());
    }

    @Test
    void aRefundOfAReturnIsCappedByWhatTheReturnRaisedLessItsLiveRefunds() {
        f.received("ret-1", "300.00", "300.00");
        create(body("100.00", "CASH").returnId("ret-1"));
        ConflictException e = assertThrows(ConflictException.class, () -> create(body("250.00", "CASH")
                .returnId("ret-1").clientRequestId("refund-key-2")));
        assertTrue(e.getMessage().startsWith("REFUND_ABOVE_RETURN"), e.getMessage());
        assertEquals("cn-ret-1", f.refunds.get(0).getCreditNoteId());
        verify(f.desk, org.mockito.Mockito.times(2)).authorize(any(), eq(INST), eq(RefundFixture.LOC), any());
    }

    @Test
    void aReturnStillOpenIsNotRefunded() {
        f.received("ret-1", "300.00", "300.00").setStatus("APPROVED");
        ConflictException e = assertThrows(ConflictException.class, () -> create(body("100.00", "CASH")
                .returnId("ret-1")));
        assertTrue(e.getMessage().startsWith("RETURN_STATE_CHANGED"));
    }

    @Test
    void aGatewayRefundNeedsThePayingPaymentAndIsExecutedAfterTheTransaction() {
        f.paying.setGatewayPaymentId(null);
        assertTrue(assertThrows(ConflictException.class, () -> create(body("100.00", "GATEWAY")))
                .getMessage().startsWith("GATEWAY_PAYMENT_UNKNOWN"));
        f.paying.setPaying(false);
        assertTrue(assertThrows(ConflictException.class, () -> create(body("100.00", "GATEWAY")))
                .getMessage().startsWith("REFUND_METHOD_NOT_AVAILABLE"));
        f.paying.setPaying(true);
        f.paying.setGatewayPaymentId(PAYMENT);

        RefundDtos.RefundView view = create(body("100.00", "GATEWAY"));
        CommerceRefund row = f.refunds.get(0);
        assertEquals("PENDING", row.getStatus());
        assertEquals("RAZORPAY", row.getGatewayVendor());
        assertEquals(PAYMENT, row.getGatewayPaymentId());
        assertEquals("log-1", row.getPaymentLogId());
        assertNotNull(row.getNextPollAt());
        assertEquals(0, new BigDecimal("100.00").compareTo(f.order.getRefundCommitted()));
        assertEquals(0, BigDecimal.ZERO.compareTo(f.order.getAmountRefunded()));
        verify(f.executor).execute(row.getId());
        assertEquals(row.getId(), view.getId());
    }

    @Test
    void theGatewayCapIsWhatThePaymentCapturedLessItsLiveRefunds() {
        f.order.setRefundDue(new BigDecimal("1000.00"));
        f.paying.setAmountMinor(50000L);
        f.pendingGateway("400.00");
        ConflictException e = assertThrows(ConflictException.class, () -> create(body("100.01", "GATEWAY")));
        assertTrue(e.getMessage().startsWith("REFUND_ABOVE_PAID"), e.getMessage());
        create(body("100.00", "GATEWAY"));
    }

    @Test
    void aBankOrUpiRefundWithAReferenceIsPaidAtOnceWithoutOneItWaitsForItsPayout() {
        RefundDtos.RefundView paid = create(body("100.00", "UPI").reference("UPI-REF-1"));
        assertEquals("PROCESSED", paid.getStatus());
        RefundDtos.RefundView waiting = create(body("200.00", "BANK_TRANSFER").clientRequestId("refund-key-2"));
        assertEquals("PENDING", waiting.getStatus());
        assertEquals(0, new BigDecimal("300.00").compareTo(f.order.getRefundCommitted()));
        assertEquals(0, new BigDecimal("100.00").compareTo(f.order.getAmountRefunded()));
        verify(f.executor, never()).execute(anyString());

        RefundDtos.RefundView payout = f.service.recordPayout(RefundFixture.manager(), INST, waiting.getId(),
                RefundDtos.PayoutRequest.builder().clientRequestId("payout-key-1").reference("UTR123")
                        .paidOn(f.today.minusDays(1).toString()).build());
        assertEquals("PROCESSED", payout.getStatus());
        assertEquals("UTR123", f.find(waiting.getId()).orElseThrow().getReference());
        assertEquals(0, new BigDecimal("300.00").compareTo(f.order.getAmountRefunded()));
        // A payout on a refund already paid is refused.
        ConflictException again = assertThrows(ConflictException.class, () -> f.service.recordPayout(
                RefundFixture.manager(), INST, waiting.getId(), RefundDtos.PayoutRequest.builder()
                        .clientRequestId("payout-key-2").reference("UTR124").build()));
        assertTrue(again.getMessage().startsWith("REFUND_STATE_CHANGED"));
    }

    @Test
    void aPayoutDatedInAClosedStockPeriodIsRefused() {
        StockPeriodGuard guard = mock(StockPeriodGuard.class);
        doThrow(new ConflictException("PERIOD_LOCKED: closed")).when(guard).assertOpen(eq(INST), any());
        when(f.periodGuard.getIfAvailable()).thenReturn(guard);
        org.mockito.Mockito.doAnswer(call -> {
            ((Consumer<StockPeriodGuard>) call.getArgument(0)).accept(guard);
            return null;
        }).when(f.periodGuard).ifAvailable(any());
        ConflictException e = assertThrows(ConflictException.class, () -> create(body("100.00", "CASH")
                .paidOn(f.today.minusDays(3).toString())));
        assertTrue(e.getMessage().startsWith("PERIOD_LOCKED"));
        assertTrue(f.refunds.isEmpty());
    }

    @Test
    void aPendingRefundIsCancelledAndItsDueIsOpenAgain() {
        RefundDtos.RefundView waiting = create(body("200.00", "BANK_TRANSFER"));
        RefundDtos.RefundView cancelled = f.service.cancel(RefundFixture.manager(), INST, waiting.getId(),
                RefundDtos.CancelRequest.builder().clientRequestId("cancel-key-1").reason("buyer gave a new account")
                        .build());
        assertEquals("FAILED", cancelled.getStatus());
        assertEquals("CANCELLED", f.find(waiting.getId()).orElseThrow().getFailureCode());
        assertEquals(0, BigDecimal.ZERO.compareTo(f.order.getRefundCommitted()));
        verify(f.auditService).record(eq(INST), eq("user-1"), any(), eq("REFUND_CANCELLED"), eq("REFUND"),
                eq(waiting.getId()), any(), any(), eq("buyer gave a new account"));
    }

    @Test
    void anExchangeCreditIsMadeOnlyThroughTheExchangeOrderAndBadBodiesAre400() {
        ConflictException e = assertThrows(ConflictException.class, () -> create(body("10.00", "EXCHANGE_CREDIT")));
        assertTrue(e.getMessage().startsWith("USE_EXCHANGE_ORDER"));
        assertThrows(InvalidRequestException.class, () -> create(body("10.001", "CASH")));
        assertThrows(InvalidRequestException.class, () -> create(body("0", "CASH")));
        assertThrows(InvalidRequestException.class, () -> create(body("10.00", "CHEQUE")));
        assertThrows(InvalidRequestException.class, () -> create(body("10.00", "CASH").reason(null)));
        assertThrows(InvalidRequestException.class, () -> create(body("10.00", "CASH").clientRequestId("short")));
        assertThrows(InvalidRequestException.class, () -> create(body("10.00", "CASH")
                .paidOn(f.today.plusDays(1).toString())));
        assertThrows(InvalidRequestException.class, () -> create(body("10.00", "CASH").gatewayRefundId("rfnd_1")));
        assertTrue(f.refunds.isEmpty());
    }

    @Test
    void anAdoptedGatewayRefundMustMatchThePaymentAmountAndStatus() {
        when(f.gateway.fetchRefund(INST, PAYMENT, "rfnd_9")).thenReturn(gatewayRefund("rfnd_9", PAYMENT, 10000L, "processed"));
        assertTrue(assertThrows(ConflictException.class, () -> create(body("99.00", "GATEWAY")
                .gatewayRefundId("rfnd_9"))).getMessage().startsWith("GATEWAY_REFUND_MISMATCH"));
        when(f.gateway.fetchRefund(INST, PAYMENT, "rfnd_8")).thenReturn(gatewayRefund("rfnd_8", "pay_other", 10000L,
                "processed"));
        assertTrue(assertThrows(ConflictException.class, () -> create(body("100.00", "GATEWAY")
                .gatewayRefundId("rfnd_8"))).getMessage().startsWith("GATEWAY_REFUND_MISMATCH"));
        when(f.gateway.fetchRefund(INST, PAYMENT, "rfnd_7")).thenReturn(gatewayRefund("rfnd_7", PAYMENT, 10000L, "failed"));
        assertTrue(assertThrows(ConflictException.class, () -> create(body("100.00", "GATEWAY")
                .gatewayRefundId("rfnd_7"))).getMessage().startsWith("GATEWAY_REFUND_MISMATCH"));
        when(f.gateway.fetchRefund(INST, PAYMENT, "rfnd_6")).thenThrow(new CommercePaymentGatewayException(
                CommercePaymentGatewayException.UNAVAILABLE, "down"));
        assertTrue(assertThrows(ConflictException.class, () -> create(body("100.00", "GATEWAY")
                .gatewayRefundId("rfnd_6"))).getMessage().startsWith("GATEWAY_REFUND_MISMATCH"));
        assertTrue(f.refunds.isEmpty());

        when(f.gateway.fetchRefund(INST, PAYMENT, "rfnd_1")).thenReturn(gatewayRefund("rfnd_1", PAYMENT, 10000L, "processed"));
        RefundDtos.RefundView adopted = create(body("100.00", "GATEWAY").gatewayRefundId("rfnd_1"));
        assertEquals("PROCESSED", adopted.getStatus());
        assertEquals("rfnd_1", adopted.getGatewayRefundId());
        verify(f.executor, never()).execute(anyString());
    }

    @Test
    void aProcessedRefundResolvesItsExceptionRowsAndTellsTheBooksAndTheBuyer() {
        CommerceRefund pending = f.pendingGateway("600.00");
        assertTrue(f.service.markProcessed(pending.getId(), CommerceRefundService.Facts.gateway("processed",
                "ARN1")));
        assertEquals(0, new BigDecimal("600.00").compareTo(f.order.getAmountRefunded()));
        verify(f.exceptions).resolveByRefund(eq(pending.getId()), anyString(), any());
        // The whole due is refunded: the old REFUND_DUE rows of the order are resolved too.
        verify(f.exceptions).resolveRefundDue(eq(ORDER), any());
        verify(f.dueService).closeReady(f.order);
        verify(f.moneyHook).refundProcessed(INST, ORDER, pending.getId(), "GATEWAY", new BigDecimal("600.00"));
        assertTrue(f.eventTypes.contains(CommerceOrderEvents.REFUND_PROCESSED));

        // A replay (webhook again, poll) changes nothing.
        assertFalse(f.service.markProcessed(pending.getId(), CommerceRefundService.Facts.gateway("processed", null)));
        assertEquals(0, new BigDecimal("600.00").compareTo(f.order.getAmountRefunded()));
        verify(f.moneyHook).refundProcessed(any(), any(), any(), any(), any());
    }

    @Test
    void aPartRefundLeavesTheOldRefundDueRowsOpen() {
        CommerceRefund pending = f.pendingGateway("100.00");
        f.service.markProcessed(pending.getId(), null);
        verify(f.exceptions, never()).resolveRefundDue(anyString(), any());
    }

    @Test
    void aFailedRefundOpensTheDueAgainAndAFinalStatusNeverMoves() {
        CommerceRefund pending = f.pendingGateway("250.00");
        assertTrue(f.service.markFailed(pending.getId(), "GATEWAY_FAILED", "declined"));
        assertEquals(0, BigDecimal.ZERO.compareTo(f.order.getRefundCommitted()));
        assertFalse(f.service.markProcessed(pending.getId(), null), "a late opposite event changes nothing");
        assertFalse(f.service.markFailed(pending.getId(), "GATEWAY_FAILED", "again"));
        assertEquals(0, BigDecimal.ZERO.compareTo(f.order.getAmountRefunded()));
        verify(f.moneyHook, never()).refundProcessed(any(), any(), any(), any(), any());
    }

    @Test
    void anOversoldPaidOrderGetsItsWholePaymentDueAndAGatewayRefundOnce() {
        f.order.setStatus("CANCELLED");
        f.order.setRefundDue(BigDecimal.ZERO.setScale(2));
        String id = f.service.autoOversold(INST, ORDER);
        CommerceRefund row = f.find(id).orElseThrow();
        assertEquals("AUTO:OVERSOLD:" + ORDER, row.getIdempotencyKey());
        assertEquals("OVERSOLD_PAID", row.getSource());
        assertEquals("GATEWAY", row.getMethod());
        assertEquals("PENDING", row.getStatus());
        assertEquals(0, new BigDecimal("1000.00").compareTo(row.getAmount()));
        assertEquals(0, new BigDecimal("1000.00").compareTo(f.order.getRefundDue()));
        assertEquals(0, new BigDecimal("1000.00").compareTo(f.order.getRefundCommitted()));
        verify(f.exceptions).linkRefund(ORDER, "OVERSOLD_PAID", "", id);
        // Called again (the poll's retry): the same refund, nothing new.
        assertEquals(id, f.service.autoOversold(INST, ORDER));
        assertEquals(1, f.refunds.size());
    }

    @Test
    void anOversoldOrderWithoutAPayingPaymentGetsNoRefund() {
        f.order.setRefundDue(BigDecimal.ZERO.setScale(2));
        f.paying.setPaying(false);
        assertNull(f.service.autoOversold(INST, ORDER));
        assertTrue(f.refunds.isEmpty());
    }

    @Test
    void aDuplicatePaymentIsGivenBackOutsideTheOrderLedger() {
        String id = f.service.autoDuplicate(INST, ORDER, "pay_second", new BigDecimal("499.00"));
        CommerceRefund row = f.find(id).orElseThrow();
        assertEquals("EXTRA_PAYMENT", row.getKind());
        assertEquals("pay_second", row.getGatewayPaymentId());
        assertEquals("AUTO:DUP:pay_second", row.getIdempotencyKey());
        assertEquals(0, BigDecimal.ZERO.compareTo(f.order.getRefundCommitted()), "order money untouched");
        verify(f.exceptions).linkRefund(ORDER, "DUPLICATE_PAYMENT", "pay_second", id);
        assertTrue(f.service.markProcessed(id, null));
        assertEquals(0, BigDecimal.ZERO.compareTo(f.order.getAmountRefunded()));
        assertEquals(id, f.service.autoDuplicate(INST, ORDER, "pay_second", new BigDecimal("499.00")));
    }

    @Test
    void anotherInstitutesRefundIsNotFound() {
        VacademyException e = assertThrows(VacademyException.class, () -> f.service.get(RefundFixture.manager(),
                INST, "refund-of-someone-else"));
        assertTrue(e.getMessage().startsWith("REFUND_NOT_FOUND"));
    }

    // ------------------------------------------------------------------ review follow-ups

    @Test
    void aCancelMovesOnlyAPendingRefund_aRefundClaimedMeanwhileIsRefusedAndKeepsItsCommitment() {
        CommerceRefund claimed = f.pendingGateway("200.00");
        // The cancel reads PENDING; the executor's claim commits before the cancel's update.
        when(f.refundRepository.cancelPending(eq(claimed.getId()), any(), anyString(), any(), any())).thenAnswer(
                call -> {
                    claimed.setStatus("IN_PROGRESS");
                    return 0;
                });
        ConflictException e = assertThrows(ConflictException.class, () -> f.service.cancel(RefundFixture.manager(),
                INST, claimed.getId(), RefundDtos.CancelRequest.builder().clientRequestId("cancel-key-9")
                        .reason("changed mind").build()));
        assertTrue(e.getMessage().startsWith("REFUND_STATE_CHANGED"), e.getMessage());
        assertEquals("IN_PROGRESS", claimed.getStatus());
        assertEquals(0, new BigDecimal("200.00").compareTo(f.order.getRefundCommitted()), "still committed");
        verify(f.refundRepository, never()).markFailed(anyString(), any(), anyString(), any(), any(), any());
        verify(f.auditService, never()).record(any(), any(), any(), eq("REFUND_CANCELLED"), any(), any(), any(),
                any(), any());
    }

    @Test
    void theOversoldRefundTakesThePayingPaymentReadAsAValueNotAStaleRow() {
        f.order.setStatus("CANCELLED");
        f.order.setRefundDue(BigDecimal.ZERO.setScale(2));
        // The managed row still names the payment that failed; the database names the one that paid.
        f.paying.setGatewayPaymentId("pay_failed_a");
        when(f.gatewayOrders.findPayingPaymentId(ORDER)).thenReturn(java.util.Optional.of("pay_captured_b"));
        String id = f.service.autoOversold(INST, ORDER);
        assertEquals("pay_captured_b", f.find(id).orElseThrow().getGatewayPaymentId());
    }

    @Test
    void anOversoldOrderRefundedOtherwiseIsResolvedAndAPendingOtherRefundKeepsItOpen() {
        f.order.setStatus("CANCELLED");
        f.order.setRefundDue(new BigDecimal("1000.00"));
        f.order.setRefundCommitted(new BigDecimal("1000.00"));
        f.order.setAmountRefunded(BigDecimal.ZERO.setScale(2));
        assertNull(f.service.autoOversold(INST, ORDER), "a bank transfer is still pending");
        verify(f.exceptions, never()).resolveOversoldRefundedOtherwise(anyString(), anyString(), any());
        f.order.setAmountRefunded(new BigDecimal("1000.00"));
        assertNull(f.service.autoOversold(INST, ORDER));
        verify(f.exceptions).resolveOversoldRefundedOtherwise(eq(ORDER), anyString(), any());
        assertTrue(f.refunds.isEmpty());
    }

    @Test
    void withCommerceOffNoAutomaticRefundIsMade() {
        when(f.accessGuard.featureOn(eq(INST), any())).thenReturn(false);
        f.order.setRefundDue(BigDecimal.ZERO.setScale(2));
        assertNull(f.service.autoOversold(INST, ORDER));
        assertNull(f.service.autoDuplicate(INST, ORDER, "pay_second", new BigDecimal("499.00")));
        assertTrue(f.refunds.isEmpty());
        verify(f.desk, never()).lockOrder(anyString(), anyString());
        assertEquals(0, BigDecimal.ZERO.compareTo(f.order.getRefundDue()), "no due raised");
    }

    @Test
    void adoptingAGatewayRefundWhoseReceiptIsOneOfOurRefundsIsRefused() {
        CommerceRefund ours = f.pendingGateway("100.00");
        ours.setStatus("IN_PROGRESS");
        BigDecimal committed = f.order.getRefundCommitted();
        when(f.gateway.fetchRefund(INST, PAYMENT, "rfnd_X")).thenReturn(new CommercePaymentGateway.GatewayRefund(
                "rfnd_X", PAYMENT, 10000L, "INR", "processed", ours.getId(), "ARN", Instant.now()));
        ConflictException e = assertThrows(ConflictException.class, () -> create(body("100.00", "GATEWAY")
                .gatewayRefundId("rfnd_X")));
        assertTrue(e.getMessage().startsWith("GATEWAY_REFUND_MISMATCH"), e.getMessage());
        assertTrue(e.getMessage().contains(ours.getId()), e.getMessage());
        assertEquals(1, f.refunds.size());
        assertEquals(0, committed.compareTo(f.order.getRefundCommitted()));
    }

    @Test
    void anOppositeOutcomeOnAFinalRowIsAConflictAndTheSameOutcomeIsNot() {
        CommerceRefund failed = f.pendingGateway("100.00");
        failed.setStatus("FAILED");
        CommerceRefund processed = f.pendingGateway("50.00");
        processed.setStatus("PROCESSED");
        assertTrue(f.service.outcomeConflict(failed.getId(), "processed", "rfnd_1", "test"));
        assertTrue(f.service.outcomeConflict(failed.getId(), "pending", "rfnd_1", "test"));
        assertFalse(f.service.outcomeConflict(failed.getId(), "failed", "rfnd_1", "test"));
        assertTrue(f.service.outcomeConflict(processed.getId(), "failed", "rfnd_2", "test"));
        assertFalse(f.service.outcomeConflict(processed.getId(), "processed", "rfnd_2", "test"));
    }

    @Test
    void theAnswerOfARouteIsTheRowAsStoredNotTheRequestsCopy() {
        jakarta.persistence.EntityManager em = mock(jakarta.persistence.EntityManager.class);
        when(em.contains(any())).thenReturn(true);
        org.springframework.test.util.ReflectionTestUtils.setField(f.service, "entityManager", em);
        CommerceRefund row = f.pendingGateway("100.00");
        f.service.view(INST, row.getId(), false);
        verify(em).refresh(row);
    }

    private static CommercePaymentGateway.GatewayRefund gatewayRefund(String id, String payment, long amount,
                                                                     String status) {
        return new CommercePaymentGateway.GatewayRefund(id, payment, amount, "INR", status, null, "ARN",
                Instant.now());
    }

    @SuppressWarnings("unused")
    private static LocalDate day(String text) {
        return LocalDate.parse(text);
    }
}
