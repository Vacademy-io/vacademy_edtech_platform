package vacademy.io.admin_core_service.features.commerce.returns.job;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceRefundHook;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentException;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundExecutor;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The refund poll: due rows, its caps and budget, the stuck alert, the hook retry, and nothing at all without rows. */
class CommerceRefundPollJobTest {

    private CommerceRefundRepository refunds;
    private CommerceRefundExecutor executor;
    private CommercePaymentExceptionRepository exceptions;
    private CommerceRefundHook hook;
    private final AtomicLong clock = new AtomicLong(1_000_000L);
    private CommerceRefundPollJob job;
    private final Date now = new Date(1_800_000_000_000L);

    @BeforeEach
    void setUp() {
        refunds = mock(CommerceRefundRepository.class);
        executor = mock(CommerceRefundExecutor.class);
        exceptions = mock(CommercePaymentExceptionRepository.class);
        hook = mock(CommerceRefundHook.class);
        job = new CommerceRefundPollJob(refunds, executor, exceptions, hook, mock(PlatformTransactionManager.class),
                clock::get);
        when(executor.execute(anyString(), any())).thenReturn(CommerceRefundExecutor.Result.PROCESSED);
        when(executor.check(anyString(), any())).thenReturn(CommerceRefundExecutor.Result.PENDING_AT_GATEWAY);
    }

    private static CommerceRefundRepository.DueRefund row(String id, String institute) {
        CommerceRefundRepository.DueRefund row = mock(CommerceRefundRepository.DueRefund.class);
        when(row.getId()).thenReturn(id);
        when(row.getInstituteId()).thenReturn(institute);
        return row;
    }

    @Test
    void withNoRowsThereIsNoGatewayCallAndNoWrite() {
        Map<String, Integer> counts = job.runOnce(now);
        assertTrue(counts.isEmpty());
        verifyNoInteractions(executor, hook);
        verify(refunds, never()).markStuckAlerted(anyString(), any());
        verify(refunds, never()).claim(anyString(), any(), any());
    }

    @Test
    void pendingRowsOlderThanThirtySecondsAreExecutedAndInProgressRowsChecked() {
        List<CommerceRefundRepository.DueRefund> pending = List.of(row("r1", "i1"));
        List<CommerceRefundRepository.DueRefund> inProgress = List.of(row("r2", "i1"));
        when(refunds.findDuePending(eq(now), any(), eq(50))).thenReturn(pending);
        when(refunds.findDueInProgress(now, 50)).thenReturn(inProgress);
        job.runOnce(now);
        ArgumentCaptor<Date> createdBefore = ArgumentCaptor.forClass(Date.class);
        verify(refunds).findDuePending(eq(now), createdBefore.capture(), eq(50));
        assertEquals(now.getTime() - 30_000, createdBefore.getValue().getTime());
        verify(executor).execute("r1", now);
        verify(executor).check("r2", now);
    }

    @Test
    void atMostFiftyRowsARunAndTwentyPerInstitute() {
        List<CommerceRefundRepository.DueRefund> many = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            many.add(row("a" + i, "busy-shop"));
        }
        for (int i = 0; i < 40; i++) {
            many.add(row("b" + i, "shop-" + i));
        }
        when(refunds.findDuePending(any(), any(), anyInt())).thenReturn(many);
        job.runOnce(now);
        verify(executor, times(50)).execute(anyString(), any());
        verify(executor, never()).execute(eq("a20"), any());
        verify(refunds, never()).findDueInProgress(any(), anyInt());
    }

    @Test
    void noNewRowIsStartedAfterTheRunBudget() {
        List<CommerceRefundRepository.DueRefund> two = List.of(row("r1", "i1"), row("r2", "i1"));
        when(refunds.findDuePending(any(), any(), anyInt())).thenReturn(two);
        when(executor.execute(eq("r1"), any())).thenAnswer(call -> {
            clock.addAndGet(41_000);
            return CommerceRefundExecutor.Result.PROCESSED;
        });
        job.runOnce(now);
        verify(executor, never()).execute(eq("r2"), any());
        verify(exceptions, never()).findUnrefunded(any(), anyInt());
    }

    @Test
    void aRefundStuckForThreeDaysIsAlertedAndMarkedSoTheAlertComesOnceADay() {
        CommerceRefundRepository.DueRefund stuck = row("s1", "i1");
        when(refunds.findStuck(any(), any(), anyInt())).thenReturn(List.of(stuck));
        job.runOnce(now);
        ArgumentCaptor<Date> claimedBefore = ArgumentCaptor.forClass(Date.class);
        ArgumentCaptor<Date> alertedBefore = ArgumentCaptor.forClass(Date.class);
        verify(refunds).findStuck(claimedBefore.capture(), alertedBefore.capture(), anyInt());
        assertEquals(now.getTime() - 72L * 3600 * 1000, claimedBefore.getValue().getTime());
        assertEquals(now.getTime() - 24L * 3600 * 1000, alertedBefore.getValue().getTime());
        verify(refunds).markStuckAlerted("s1", now);
    }

    @Test
    void exceptionRowsWithoutTheirRefundGetTheHookAgain() {
        CommercePaymentException oversold = new CommercePaymentException();
        oversold.setKind("OVERSOLD_PAID");
        oversold.setInstituteId("i1");
        oversold.setCommerceOrderId("o1");
        oversold.setOrderNumber("ORD-1");
        oversold.setAmount(new BigDecimal("100.00"));
        oversold.setCurrency("INR");
        CommercePaymentException duplicate = new CommercePaymentException();
        duplicate.setKind("DUPLICATE_PAYMENT");
        duplicate.setInstituteId("i1");
        duplicate.setCommerceOrderId("o2");
        duplicate.setGatewayOrderId("order_rzp");
        duplicate.setGatewayPaymentId("pay_2");
        duplicate.setAmount(new BigDecimal("50.00"));
        duplicate.setCurrency("INR");
        when(exceptions.findUnrefunded(any(), eq(20))).thenReturn(List.of(oversold, duplicate));
        job.runOnce(now);
        ArgumentCaptor<Date> createdBefore = ArgumentCaptor.forClass(Date.class);
        verify(exceptions).findUnrefunded(createdBefore.capture(), eq(20));
        assertEquals(now.getTime() - 120_000, createdBefore.getValue().getTime());
        verify(hook).refundOversoldPaidOrder("i1", "o1", "ORD-1", new BigDecimal("100.00"), "INR");
        verify(hook).refundDuplicatePayment("i1", "o2", null, "order_rzp", "pay_2", new BigDecimal("50.00"), "INR");
    }

    @Test
    void aFailingRowDoesNotStopTheOthersAndTheJobNeverThrows() {
        List<CommerceRefundRepository.DueRefund> two = List.of(row("r1", "i1"), row("r2", "i1"));
        when(refunds.findDuePending(any(), any(), anyInt())).thenReturn(two);
        when(executor.execute(eq("r1"), any())).thenThrow(new IllegalStateException("boom"));
        Map<String, Integer> counts = job.runOnce(now);
        verify(executor).execute("r2", now);
        assertEquals(1, counts.get("errors"));
        when(refunds.findDuePending(any(), any(), anyInt())).thenThrow(new IllegalStateException("db down"));
        job.run();
    }
}
