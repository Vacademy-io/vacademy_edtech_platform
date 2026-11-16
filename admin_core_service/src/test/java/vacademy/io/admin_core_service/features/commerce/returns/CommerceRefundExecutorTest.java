package vacademy.io.admin_core_service.features.commerce.returns;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGateway;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGatewayException;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundExecutor;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.PAYMENT;

/**
 * One gateway refund is sent at most once: the claim, the payment check before any create, the
 * backoff while the gateway does not answer, and a create whose answer is unclear left to the poll.
 */
class CommerceRefundExecutorTest {

    private RefundFixture f;
    private CommerceRefundExecutor executor;
    private final Date now = new Date();

    @BeforeEach
    void setUp() {
        f = new RefundFixture();
        executor = new CommerceRefundExecutor(f.refundRepository, f.service, f.gateway, f.transactionManager);
        when(f.refundRepository.release(anyString(), any(), any())).thenAnswer(call -> {
            CommerceRefund r = f.find(call.getArgument(0)).orElseThrow();
            r.setStatus("PENDING");
            r.setNextPollAt(call.getArgument(1));
            return 1;
        });
    }

    private void captured(long amount, long refunded) {
        when(f.gateway.fetchPayment(INST, PAYMENT)).thenReturn(new CommercePaymentGateway.GatewayPayment(PAYMENT,
                "order_rzp1", "captured", amount, "INR", Instant.now(), refunded, null));
    }

    private static CommercePaymentGateway.GatewayRefund answer(String status, long amount) {
        return new CommercePaymentGateway.GatewayRefund("rfnd_1", PAYMENT, amount, "INR", status, null, "ARN1",
                Instant.now());
    }

    @Test
    void aRowSomeoneElseClaimedMakesNoRemoteCall() {
        CommerceRefund r = f.pendingGateway("200.00");
        r.setStatus("IN_PROGRESS");
        assertEquals(CommerceRefundExecutor.Result.NOT_CLAIMED, executor.execute(r.getId(), now));
        CommerceRefund later = f.pendingGateway("100.00");
        later.setNextPollAt(new Date(now.getTime() + 60_000));
        assertEquals(CommerceRefundExecutor.Result.NOT_CLAIMED, executor.execute(later.getId(), now));
        org.mockito.Mockito.verifyNoInteractions(f.gateway);
    }

    @Test
    void aProcessedAnswerFinishesTheRefundWithOneCreateAndTheRefundIdAsReceipt() {
        CommerceRefund r = f.pendingGateway("200.00");
        captured(100000L, 0L);
        when(f.gateway.createRefund(eq(INST), eq(PAYMENT), eq(20000L), eq(r.getId()), any()))
                .thenReturn(answer("processed", 20000L));
        assertEquals(CommerceRefundExecutor.Result.PROCESSED, executor.execute(r.getId(), now));
        assertEquals("PROCESSED", r.getStatus());
        ArgumentCaptor<Map<String, String>> notes = ArgumentCaptor.forClass(Map.class);
        verify(f.gateway, times(1)).createRefund(eq(INST), eq(PAYMENT), eq(20000L), eq(r.getId()), notes.capture());
        assertEquals(r.getId(), notes.getValue().get("commerce_refund_id"));
        verify(f.refundRepository).storeGatewayRefund(r.getId(), "rfnd_1", "processed", "ARN1");
        // A second run, a replay or the poll: nothing is claimed, nothing is sent.
        assertEquals(CommerceRefundExecutor.Result.NOT_CLAIMED, executor.execute(r.getId(), now));
        verify(f.gateway, times(1)).createRefund(anyString(), anyString(), anyLong(), anyString(), any());
    }

    @Test
    void aPendingAnswerStaysInProgressAndAFailedOneFails() {
        CommerceRefund pending = f.pendingGateway("200.00");
        captured(100000L, 0L);
        when(f.gateway.createRefund(anyString(), anyString(), anyLong(), eq(pending.getId()), any()))
                .thenReturn(answer("pending", 20000L));
        assertEquals(CommerceRefundExecutor.Result.PENDING_AT_GATEWAY, executor.execute(pending.getId(), now));
        assertEquals("IN_PROGRESS", pending.getStatus());
        assertEquals(now.getTime() + 2 * 60_000L, pending.getNextPollAt().getTime(),
                "the claim set the first check two minutes on");
        verify(f.refundRepository, never()).reschedule(eq(pending.getId()), any(), any(), any());

        CommerceRefund failed = f.pendingGateway("100.00");
        when(f.gateway.createRefund(anyString(), anyString(), anyLong(), eq(failed.getId()), any()))
                .thenReturn(answer("failed", 10000L));
        assertEquals(CommerceRefundExecutor.Result.FAILED, executor.execute(failed.getId(), now));
        assertEquals("FAILED", failed.getStatus());
        assertEquals("GATEWAY_FAILED", failed.getFailureCode());
    }

    @Test
    void thePaymentCheckFailsTheRefundWithoutAnyCreate() {
        CommerceRefund notCaptured = f.pendingGateway("200.00");
        when(f.gateway.fetchPayment(INST, PAYMENT)).thenReturn(new CommercePaymentGateway.GatewayPayment(PAYMENT,
                "order_rzp1", "authorized", 100000L, "INR", Instant.now()));
        assertEquals(CommerceRefundExecutor.Result.FAILED, executor.execute(notCaptured.getId(), now));
        assertEquals("PAYMENT_NOT_CAPTURED", notCaptured.getFailureCode());

        CommerceRefund short1 = f.pendingGateway("200.00");
        captured(100000L, 90000L);
        assertEquals(CommerceRefundExecutor.Result.FAILED, executor.execute(short1.getId(), now));
        assertEquals("GATEWAY_BALANCE_SHORT", short1.getFailureCode());

        CommerceRefund notConfigured = f.pendingGateway("10.00");
        when(f.gateway.fetchPayment(INST, PAYMENT)).thenThrow(new CommercePaymentGatewayException(
                CommercePaymentGatewayException.NOT_CONFIGURED, "no keys"));
        assertEquals(CommerceRefundExecutor.Result.FAILED, executor.execute(notConfigured.getId(), now));
        assertEquals("GATEWAY_NOT_CONFIGURED", notConfigured.getFailureCode());
        verify(f.gateway, never()).createRefund(anyString(), anyString(), anyLong(), anyString(), any());
    }

    @Test
    void aGatewayThatDoesNotAnswerBeforeTheCreateIsTriedAgainWithBackoffThenFailedAfterFiveTries() {
        CommerceRefund r = f.pendingGateway("200.00");
        when(f.gateway.fetchPayment(INST, PAYMENT)).thenThrow(new CommercePaymentGatewayException(
                CommercePaymentGatewayException.UNAVAILABLE, "timeout"));
        Date at = now;
        for (int attempt = 1; attempt <= 4; attempt++) {
            assertEquals(CommerceRefundExecutor.Result.RETRY_LATER, executor.execute(r.getId(), at));
            assertEquals("PENDING", r.getStatus());
            long waited = r.getNextPollAt().getTime() - at.getTime();
            assertEquals(Math.min(1L << attempt, 60) * 60_000L, waited, "backoff after attempt " + attempt);
            at = r.getNextPollAt();
        }
        assertEquals(CommerceRefundExecutor.Result.FAILED, executor.execute(r.getId(), at));
        assertEquals("FAILED", r.getStatus());
        assertEquals("GATEWAY_UNAVAILABLE", r.getFailureCode());
        verify(f.gateway, never()).createRefund(anyString(), anyString(), anyLong(), anyString(), any());
    }

    @Test
    void aCreateWithoutAClearAnswerStaysInProgressAndIsNeverSentAgain() {
        CommerceRefund r = f.pendingGateway("200.00");
        captured(100000L, 0L);
        when(f.gateway.createRefund(anyString(), anyString(), anyLong(), anyString(), any()))
                .thenThrow(new CommercePaymentGatewayException(CommercePaymentGatewayException.UNAVAILABLE,
                        "read timed out"));
        assertEquals(CommerceRefundExecutor.Result.CREATE_UNKNOWN, executor.execute(r.getId(), now));
        assertEquals("IN_PROGRESS", r.getStatus());
        verify(f.refundRepository).noteError(eq(r.getId()), anyString());
        assertEquals(CommerceRefundExecutor.Result.NOT_CLAIMED, executor.execute(r.getId(),
                new Date(now.getTime() + 3_600_000)));
        verify(f.gateway, times(1)).createRefund(anyString(), anyString(), anyLong(), anyString(), any());
    }

    @Test
    void thePollFindsALostCreateByItsReceiptAndFailsOnlyAfterFifteenMinutesWithNothingFound() {
        CommerceRefund found = f.pendingGateway("200.00");
        found.setStatus("IN_PROGRESS");
        found.setClaimedAt(now);
        when(f.gateway.fetchRefunds(INST, PAYMENT)).thenReturn(List.of(new CommercePaymentGateway.GatewayRefund(
                "rfnd_7", PAYMENT, 20000L, "INR", "processed", found.getId(), null, Instant.now())));
        assertEquals(CommerceRefundExecutor.Result.PROCESSED, executor.check(found.getId(), now));
        verify(f.refundRepository).storeGatewayRefund(found.getId(), "rfnd_7", "processed", null);

        CommerceRefund lost = f.pendingGateway("100.00");
        lost.setStatus("IN_PROGRESS");
        lost.setClaimedAt(now);
        assertEquals(CommerceRefundExecutor.Result.RETRY_LATER,
                executor.check(lost.getId(), new Date(now.getTime() + 14 * 60_000L)));
        assertEquals("IN_PROGRESS", lost.getStatus());
        assertEquals(CommerceRefundExecutor.Result.FAILED,
                executor.check(lost.getId(), new Date(now.getTime() + 15 * 60_000L)));
        assertEquals("GATEWAY_NOT_CREATED", lost.getFailureCode());
    }

    @Test
    void aPollErrorOnlyReschedules() {
        CommerceRefund r = f.pendingGateway("200.00");
        r.setStatus("IN_PROGRESS");
        r.setGatewayRefundId("rfnd_1");
        r.setClaimedAt(new Date(now.getTime() - 3_600_000));
        when(f.gateway.fetchRefund(INST, PAYMENT, "rfnd_1")).thenThrow(new CommercePaymentGatewayException(
                CommercePaymentGatewayException.UNAVAILABLE, "x"));
        assertEquals(CommerceRefundExecutor.Result.RETRY_LATER, executor.check(r.getId(), now));
        assertEquals("IN_PROGRESS", r.getStatus());
        verify(f.refundRepository).reschedule(eq(r.getId()), eq(now), any(), any());
        assertTrue(r.getFailureCode() == null);
    }
}
