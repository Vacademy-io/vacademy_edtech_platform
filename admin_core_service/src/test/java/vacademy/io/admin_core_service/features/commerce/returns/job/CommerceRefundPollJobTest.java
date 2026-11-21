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
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;

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
    private CommerceAccessGuard guard;
    private final AtomicLong clock = new AtomicLong(1_000_000L);
    private CommerceRefundPollJob job;
    private final Date now = new Date(1_800_000_000_000L);

    @BeforeEach
    void setUp() {
        refunds = mock(CommerceRefundRepository.class);
        executor = mock(CommerceRefundExecutor.class);
        exceptions = mock(CommercePaymentExceptionRepository.class);
        hook = mock(CommerceRefundHook.class);
        guard = mock(CommerceAccessGuard.class);
        when(guard.featureState(anyString(), any())).thenReturn(CommerceAccessGuard.FeatureState.ON);
        job = new CommerceRefundPollJob(refunds, executor, exceptions, hook, guard,
                mock(PlatformTransactionManager.class), clock::get);
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
        verify(exceptions, never()).findUnrefunded(any(), any(), any(), anyInt());
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
        when(exceptions.findUnrefunded(any(), any(), any(), eq(100))).thenReturn(List.of(oversold, duplicate));
        job.runOnce(now);
        ArgumentCaptor<Date> createdBefore = ArgumentCaptor.forClass(Date.class);
        verify(exceptions).findUnrefunded(createdBefore.capture(), eq(new Date(0L)), eq(""), eq(100));
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

    @Test
    void rowsOfAnInstituteWithoutCommerceGetNoGatewayCallNoHookAndAreDeferred() {
        when(guard.featureState(eq("off-shop"), any())).thenReturn(CommerceAccessGuard.FeatureState.OFF);
        List<CommerceRefundRepository.DueRefund> pending = List.of(row("p-off", "off-shop"), row("p-on", "on-shop"));
        List<CommerceRefundRepository.DueRefund> inProgress = List.of(row("c-off", "off-shop"));
        when(refunds.findDuePending(any(), any(), anyInt())).thenReturn(pending);
        when(refunds.findDueInProgress(any(), anyInt())).thenReturn(inProgress);
        CommercePaymentException off = new CommercePaymentException();
        off.setKind("OVERSOLD_PAID");
        off.setInstituteId("off-shop");
        off.setCommerceOrderId("o-off");
        when(exceptions.findUnrefunded(any(), any(), any(), anyInt())).thenReturn(List.of(off));
        Map<String, Integer> counts = job.runOnce(now);
        verify(executor).execute("p-on", now);
        verify(executor, never()).execute(eq("p-off"), any());
        verify(executor, never()).check(anyString(), any());
        verifyNoInteractions(hook);
        verify(refunds).deferPoll("p-off", new Date(now.getTime() + 3_600_000L));
        verify(refunds).deferPoll("c-off", new Date(now.getTime() + 3_600_000L));
        assertEquals(3, counts.get("skipped_commerce_off"));
        verify(guard, times(1)).featureState(eq("off-shop"), any());
    }

    @Test
    void exceptionRowsOfInstitutesWithoutCommerceDoNotCrowdOutTheOthers() {
        List<CommercePaymentException> rows = new ArrayList<>();
        when(guard.featureState(eq("off-shop"), any())).thenReturn(CommerceAccessGuard.FeatureState.OFF);
        for (int i = 0; i < 30; i++) {
            CommercePaymentException e = new CommercePaymentException();
            e.setKind("DUPLICATE_PAYMENT");
            e.setInstituteId(i < 25 ? "off-shop" : "on-shop");
            e.setCommerceOrderId("o" + i);
            e.setGatewayPaymentId("pay_" + i);
            e.setAmount(BigDecimal.TEN);
            rows.add(e);
        }
        when(exceptions.findUnrefunded(any(), any(), any(), eq(100))).thenReturn(rows);
        job.runOnce(now);
        verify(hook, times(5)).refundDuplicatePayment(eq("on-shop"), anyString(), any(), any(), anyString(), any(),
                any());
        verify(hook, never()).refundDuplicatePayment(eq("off-shop"), anyString(), any(), any(), anyString(), any(),
                any());
    }

    @Test
    void atMostTwentyHookRetriesARun() {
        List<CommercePaymentException> rows = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            CommercePaymentException e = new CommercePaymentException();
            e.setKind("DUPLICATE_PAYMENT");
            e.setInstituteId("i1");
            e.setCommerceOrderId("o" + i);
            e.setGatewayPaymentId("pay_" + i);
            e.setAmount(BigDecimal.TEN);
            rows.add(e);
        }
        when(exceptions.findUnrefunded(any(), any(), any(), eq(100))).thenReturn(rows);
        job.runOnce(now);
        verify(hook, times(20)).refundDuplicatePayment(anyString(), anyString(), any(), any(), anyString(), any(),
                any());
    }

    // ---------------------------------------------------------------- m3: keyset pages; m4: unknown state

    /** Answers {@code findUnrefunded} as the keyset query does over {@code rows} (sorted by created_at, id). */
    private void keysetOver(List<CommercePaymentException> rows) {
        when(exceptions.findUnrefunded(any(), any(), any(), anyInt())).thenAnswer(call -> {
            Date after = call.getArgument(1);
            String afterId = call.getArgument(2);
            int max = call.getArgument(3);
            return rows.stream().filter(r -> r.getCreatedAt().after(after)
                    || (r.getCreatedAt().equals(after) && r.getId().compareTo(afterId) > 0)).limit(max).toList();
        });
    }

    private static CommercePaymentException duplicateRow(String id, String institute, long createdAt) {
        CommercePaymentException e = new CommercePaymentException();
        e.setId(id);
        e.setKind("DUPLICATE_PAYMENT");
        e.setInstituteId(institute);
        e.setCommerceOrderId("o-" + id);
        e.setGatewayPaymentId("pay_" + id);
        e.setAmount(BigDecimal.TEN);
        e.setCreatedAt(new Date(createdAt));
        return e;
    }

    private ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> capture() {
        ch.qos.logback.classic.Logger logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory
                .getLogger(CommerceRefundPollJob.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender =
                new ch.qos.logback.core.read.ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        return appender;
    }

    private static void release(ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> a) {
        ((ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(CommerceRefundPollJob.class))
                .detachAppender(a);
    }

    @Test
    void m3_aRowBehindAWholePageOfInstitutesWithoutCommerceIsStillRetried() {
        when(guard.featureState(eq("off-shop"), any())).thenReturn(CommerceAccessGuard.FeatureState.OFF);
        List<CommercePaymentException> rows = new ArrayList<>();
        for (int i = 0; i < 120; i++) {
            // Pairs share a created_at: the id breaks the tie.
            rows.add(duplicateRow(String.format("e%03d", i), "off-shop", 1_000_000L + (i / 2) * 1000L));
        }
        rows.add(duplicateRow("z-on", "on-shop", 9_000_000L));
        keysetOver(rows);
        var appender = capture();
        try {
            Map<String, Integer> counts = job.runOnce(now);
            assertEquals(120, counts.get("skipped_commerce_off"));
            assertEquals(1, counts.get("hook_retried"));
        } finally {
            release(appender);
        }
        verify(hook).refundDuplicatePayment(eq("on-shop"), eq("o-z-on"), any(), any(), eq("pay_z-on"), any(), any());
        verify(hook, never()).refundDuplicatePayment(eq("off-shop"), anyString(), any(), any(), anyString(), any(),
                any());
        verify(exceptions, times(2)).findUnrefunded(any(), any(), any(), eq(100));
        verify(exceptions).findUnrefunded(any(), eq(rows.get(99).getCreatedAt()), eq("e099"), eq(100));
        assertEquals(1, appender.list.stream().filter(e -> e.getFormattedMessage()
                .equals("COMMERCE_REFUND_POLL exception_page_all_skipped rows=100")).count());
        assertTrue(appender.list.stream().noneMatch(e -> e.getFormattedMessage().contains("exception_page")
                && e.getFormattedMessage().contains("off-shop")));
    }

    @Test
    void m3_atMostFivePagesARun() {
        when(guard.featureState(eq("off-shop"), any())).thenReturn(CommerceAccessGuard.FeatureState.OFF);
        List<CommercePaymentException> rows = new ArrayList<>();
        for (int i = 0; i < 700; i++) {
            rows.add(duplicateRow(String.format("e%04d", i), "off-shop", 1_000_000L + i * 1000L));
        }
        rows.add(duplicateRow("z-on", "on-shop", 9_000_000L));
        keysetOver(rows);
        var appender = capture();
        try {
            Map<String, Integer> counts = job.runOnce(now);
            assertEquals(500, counts.get("skipped_commerce_off"));
        } finally {
            release(appender);
        }
        verify(exceptions, times(5)).findUnrefunded(any(), any(), any(), eq(100));
        verifyNoInteractions(hook);
        assertEquals(1, appender.list.stream().filter(e -> e.getFormattedMessage()
                .contains("exception_page_all_skipped")).count());
    }

    @Test
    void m4_anUnreadableFeatureStateSkipsTheRowThisRunWithoutDeferringIt() {
        when(guard.featureState(eq("unk-shop"), any())).thenReturn(CommerceAccessGuard.FeatureState.UNKNOWN);
        List<CommerceRefundRepository.DueRefund> pending = List.of(row("p1", "unk-shop"), row("p2", "unk-shop"));
        when(refunds.findDuePending(any(), any(), anyInt())).thenReturn(pending);
        CommercePaymentException unk = duplicateRow("x1", "unk-shop", 1_000L);
        when(exceptions.findUnrefunded(any(), any(), any(), anyInt())).thenReturn(List.of(unk));
        var appender = capture();
        Map<String, Integer> counts;
        try {
            counts = job.runOnce(now);
        } finally {
            release(appender);
        }
        assertEquals(3, counts.get("skipped_feature_unknown"));
        assertEquals(null, counts.get("skipped_commerce_off"));
        verify(executor, never()).execute(anyString(), any());
        verify(refunds, never()).deferPoll(anyString(), any());
        verifyNoInteractions(hook);
        assertEquals(1, appender.list.stream().filter(e -> e.getLevel() == ch.qos.logback.classic.Level.WARN
                && e.getFormattedMessage().contains("feature state unknown")).count());

        // The resolver answers again on the next run: the row is executed.
        when(guard.featureState(eq("unk-shop"), any())).thenReturn(CommerceAccessGuard.FeatureState.ON);
        job.runOnce(now);
        verify(executor).execute("p1", now);
        verify(executor).execute("p2", now);
    }
}
