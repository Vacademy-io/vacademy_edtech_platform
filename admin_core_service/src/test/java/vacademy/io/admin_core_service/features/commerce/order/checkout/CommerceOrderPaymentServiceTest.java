package vacademy.io.admin_core_service.features.commerce.order.checkout;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderPaymentService.Outcome;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository.HoldRow;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository.LogRow;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * What a payment and a closed payment window do to an order: the confirm step and its replay,
 * the refusals, the two late-payment branches, and the expiry. Every collaborator is a mock.
 */
class CommerceOrderPaymentServiceTest {

    private static final String ORDER = "order-1";
    private static final String GROUP = "group-1";

    private CommerceOrderRepository orderRepository;
    private CommerceOrderLineRepository lineRepository;
    private CommerceOrderTenderRepository tenderRepository;
    private CommerceOrderLegacyRepository legacyRepository;
    private CommerceOrderWriter writer;
    private StockHoldService stockHoldService;
    private UserPlanService userPlanService;
    private CommerceRefundHook refundHook;
    private CommerceOrderPaymentService service;

    private CommerceOrder order;
    private final List<LogRow> logs = new ArrayList<>();
    private final List<HoldRow> holds = new ArrayList<>();

    @BeforeEach
    void setUp() {
        orderRepository = mock(CommerceOrderRepository.class);
        lineRepository = mock(CommerceOrderLineRepository.class);
        tenderRepository = mock(CommerceOrderTenderRepository.class);
        legacyRepository = mock(CommerceOrderLegacyRepository.class);
        writer = mock(CommerceOrderWriter.class);
        stockHoldService = mock(StockHoldService.class);
        userPlanService = mock(UserPlanService.class);
        refundHook = mock(CommerceRefundHook.class);
        service = new CommerceOrderPaymentService(orderRepository, lineRepository, tenderRepository,
                legacyRepository, writer, stockHoldService, userPlanService, refundHook,
                mock(PlatformTransactionManager.class));

        order = new CommerceOrder();
        order.setId(ORDER);
        order.setInstituteId("inst-1");
        order.setOrderNumber("ORD-000007");
        order.setPaymentGroupId(GROUP);
        order.setStatus(CommerceOrderStatus.PENDING_PAYMENT.name());
        order.setPaymentStatus("UNPAID");
        order.setTotal(new BigDecimal("1500.00"));
        order.setAmountPaid(new BigDecimal("0.00"));
        order.setCurrency("INR");
        order.setGatewayOrderId("order_gw_1");
        order.setPrimaryPaymentLogId("log-1");

        when(orderRepository.findById(ORDER)).thenAnswer(call -> Optional.of(order));
        when(orderRepository.lockById(ORDER)).thenAnswer(call -> Optional.of(order));
        when(orderRepository.findByPaymentGroupId(GROUP)).thenAnswer(call -> Optional.of(order));
        when(orderRepository.save(any(CommerceOrder.class))).thenAnswer(call -> call.getArgument(0));
        when(legacyRepository.findGroupIdOfLog("log-1")).thenReturn(GROUP);
        when(legacyRepository.findGroupIdOfLog("log-2")).thenReturn(GROUP);
        when(legacyRepository.findLogsOfGroup(GROUP)).thenAnswer(call -> logs);
        when(legacyRepository.findHoldsOfPlans(anyCollection())).thenAnswer(call -> holds);
        when(lineRepository.findByOrderIdOrderByLineNoAsc(ORDER)).thenReturn(List.of(
                line("plan-1", "log-1"), line("plan-2", "log-2"), line(null, null)));
        when(userPlanService.findById(anyString())).thenAnswer(call -> {
            UserPlan plan = new UserPlan();
            plan.setId(call.getArgument(0));
            plan.setStatus("ACTIVE");
            return plan;
        });
        when(tenderRepository.settlePending(eq(ORDER), anyString(), any(), any())).thenReturn(1);
    }

    // ------------------------------------------------------------------ fixtures

    private static CommerceOrderLine line(String planId, String logId) {
        CommerceOrderLine line = new CommerceOrderLine();
        line.setLineType(planId == null ? CommerceOrderLine.TYPE_SHIPPING : CommerceOrderLine.TYPE_ITEM);
        line.setUserPlanId(planId);
        line.setPaymentLogId(logId);
        return line;
    }

    private void log(String id, String status, String amount) {
        LogRow row = mock(LogRow.class);
        when(row.getId()).thenReturn(id);
        when(row.getPaymentStatus()).thenReturn(status);
        when(row.getAmount()).thenReturn(new BigDecimal(amount));
        logs.add(row);
    }

    private void hold(String planId, String status, boolean oversold) {
        HoldRow row = mock(HoldRow.class);
        when(row.getId()).thenReturn("hold-" + planId);
        when(row.getUserPlanId()).thenReturn(planId);
        when(row.getStatus()).thenReturn(status);
        when(row.getOversold()).thenReturn(oversold);
        holds.add(row);
    }

    private void paidInFull() {
        log("log-1", "PAID", "500.00");
        log("log-2", "PAID", "1000.00");
    }

    private void assertNothingChanged(String status) {
        assertEquals(status, order.getStatus());
        assertEquals("UNPAID", order.getPaymentStatus());
        assertEquals(new BigDecimal("0.00"), order.getAmountPaid());
        verify(orderRepository, never()).save(any());
        verify(tenderRepository, never()).settlePending(any(), any(), any(), any());
        verify(tenderRepository, never()).save(any());
        verify(writer, never()).history(any(), any(), any(), any(), any());
    }

    // ------------------------------------------------------------------ paid

    @Test
    void aPaidOrderIsConfirmedItsPlansActivatedAndItsTenderReceived() {
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);

        assertEquals(Outcome.CONFIRMED, service.onPaymentLogPaid("log-2"));

        assertEquals("CONFIRMED", order.getStatus());
        assertEquals("PAID", order.getPaymentStatus());
        assertEquals(new BigDecimal("1500.00"), order.getAmountPaid());
        assertNotNull(order.getConfirmedAt());
        verify(userPlanService, times(2)).activateCommercePlan(any(UserPlan.class));
        // The plans were ACTIVE already (the webhook transaction): the stock step runs again.
        verify(stockHoldService, times(2)).onPlanActivated(any(UserPlan.class), isNull());
        verify(tenderRepository).settlePending(eq(ORDER), eq(CommerceOrderTender.STATUS_RECEIVED), any(),
                eq("order_gw_1"));
        verify(writer).history(order, CommerceOrderStatus.PENDING_PAYMENT, CommerceOrderStatus.CONFIRMED, null,
                "Payment received");
        verifyNoInteractions(refundHook);
        verify(stockHoldService, never()).restoreForPlan(any(), any());
        verify(stockHoldService, never()).closeWithoutGiveBack(any(), any(), any());
    }

    @Test
    void theOrderLockIsTakenOnlyAfterPlansAndStockAreSettled() {
        paidInFull();
        service.ensurePaidOrderConfirmed(ORDER);
        InOrder inOrder = inOrder(userPlanService, orderRepository);
        inOrder.verify(userPlanService, times(2)).activateCommercePlan(any());
        inOrder.verify(orderRepository).lockById(ORDER);
    }

    @Test
    void aReplayOfAPaidOrderChangesNothing() {
        paidInFull();
        assertEquals(Outcome.CONFIRMED, service.onPaymentLogPaid("log-1"));
        org.mockito.Mockito.clearInvocations(orderRepository, tenderRepository, writer, userPlanService,
                stockHoldService);

        assertEquals(Outcome.ALREADY_SETTLED, service.onPaymentLogPaid("log-1"));
        assertEquals(Outcome.ALREADY_SETTLED, service.onPaymentLogPaid("log-2"));
        assertEquals(Outcome.ALREADY_SETTLED, service.ensurePaidOrderConfirmed(ORDER));

        verify(orderRepository, never()).save(any());
        verify(orderRepository, never()).lockById(any());
        verify(tenderRepository, never()).settlePending(any(), any(), any(), any());
        verify(writer, never()).history(any(), any(), any(), any(), any());
        verifyNoInteractions(userPlanService, stockHoldService);
        assertEquals("CONFIRMED", order.getStatus());
    }

    @Test
    void twoCallsThatBothPassTheFirstCheckConfirmOnce() {
        paidInFull();
        // The second caller read the order before the first one committed, then waits for the lock.
        when(orderRepository.lockById(ORDER)).thenAnswer(call -> {
            order.setPaymentStatus("PAID");
            order.setStatus("CONFIRMED");
            return Optional.of(order);
        });
        assertEquals(Outcome.ALREADY_SETTLED, service.ensurePaidOrderConfirmed(ORDER));
        verify(orderRepository, never()).save(any());
        verify(writer, never()).history(any(), any(), any(), any(), any());
    }

    @Test
    void aLogThatBelongsToNoOrderIsIgnored() {
        when(legacyRepository.findGroupIdOfLog("course-log")).thenReturn(null);
        when(legacyRepository.findGroupIdOfLog("grouped-course-log")).thenReturn("some-course-group");
        when(orderRepository.findByPaymentGroupId("some-course-group")).thenReturn(Optional.empty());
        assertEquals(Outcome.NOT_A_COMMERCE_ORDER, service.onPaymentLogPaid("course-log"));
        assertEquals(Outcome.NOT_A_COMMERCE_ORDER, service.onPaymentLogPaid("grouped-course-log"));
        assertEquals(Outcome.NOT_A_COMMERCE_ORDER, service.onPaymentLogPaid(" "));
        assertEquals(Outcome.NOT_A_COMMERCE_ORDER, service.ensurePaidOrderConfirmed(null));
        verifyNoInteractions(userPlanService, stockHoldService, tenderRepository, writer);
    }

    @Test
    void anOrderWithNoPaidLogIsNotConfirmed() {
        log("log-1", "PAYMENT_PENDING", "500.00");
        log("log-2", "FAILED", "1000.00");
        assertEquals(Outcome.NOT_PAID_YET, service.ensurePaidOrderConfirmed(ORDER));
        assertNothingChanged("PENDING_PAYMENT");
        verifyNoInteractions(userPlanService, stockHoldService);
    }

    @Test
    void anOrderPaidInPartIsNotConfirmed() {
        log("log-1", "PAID", "500.00");
        log("log-2", "PAYMENT_PENDING", "1000.00");
        assertEquals(Outcome.PARTLY_PAID, service.onPaymentLogPaid("log-1"));
        assertNothingChanged("PENDING_PAYMENT");
        verifyNoInteractions(userPlanService, stockHoldService);
    }

    @Test
    void paidLogsThatDoNotSumToTheTotalAreRefused() {
        log("log-1", "PAID", "500.00");
        log("log-2", "PAID", "999.00");
        assertEquals(Outcome.REFUSED_MISMATCH, service.onPaymentLogPaid("log-1"));
        assertNothingChanged("PENDING_PAYMENT");
        verifyNoInteractions(userPlanService, stockHoldService);
    }

    @Test
    void aCapturedAmountOtherThanTheTotalIsRefused() {
        paidInFull();
        assertEquals(Outcome.REFUSED_MISMATCH, service.onPaymentLogPaid("log-1", "order_gw_1", 100L));
        assertEquals(Outcome.REFUSED_MISMATCH, service.onPaymentLogPaid("log-1", "order_gw_1", 150001L));
        assertNothingChanged("PENDING_PAYMENT");
        verifyNoInteractions(userPlanService, stockHoldService);

        assertEquals(Outcome.CONFIRMED, service.onPaymentLogPaid("log-1", "order_gw_1", 150000L));
    }

    @Test
    void aPaymentOnAnotherGatewayOrderIsRefused() {
        paidInFull();
        assertEquals(Outcome.REFUSED_MISMATCH, service.onPaymentLogPaid("log-1", "order_gw_cheap", 150000L));
        assertNothingChanged("PENDING_PAYMENT");
        verifyNoInteractions(userPlanService, stockHoldService);
    }

    @Test
    void theMismatchCheckNamesWhatDiffers() {
        paidInFull();
        assertNull(CommerceOrderPaymentService.mismatch(order, logs, null, null));
        assertNull(CommerceOrderPaymentService.mismatch(order, logs, "order_gw_1", 150000L));
        assertEquals("gateway_order_differs", CommerceOrderPaymentService.mismatch(order, logs, "other", null));
        assertEquals("captured_amount_differs", CommerceOrderPaymentService.mismatch(order, logs, null, 1L));
        order.setTotal(new BigDecimal("1500.01"));
        assertEquals("log_sum_differs_from_total", CommerceOrderPaymentService.mismatch(order, logs, null, null));
        assertEquals(150001L, CommerceOrderPaymentService.minor(order.getTotal()));
    }

    @Test
    void aHoldThatIsNotSettledLeavesTheOrderForTheNextTry() {
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "HELD", false);
        assertEquals(Outcome.STOCK_NOT_SETTLED, service.ensurePaidOrderConfirmed(ORDER));
        assertNothingChanged("PENDING_PAYMENT");

        holds.clear();
        hold("plan-1", "RELEASED", false);
        assertEquals(Outcome.STOCK_NOT_SETTLED, service.ensurePaidOrderConfirmed(ORDER));
        assertNothingChanged("PENDING_PAYMENT");
    }

    @Test
    void aPlanThatWasNotYetActiveIsActivatedAndItsStockStepIsNotRunTwice() {
        paidInFull();
        when(userPlanService.findById(anyString())).thenAnswer(call -> {
            UserPlan plan = new UserPlan();
            plan.setId(call.getArgument(0));
            plan.setStatus("PENDING_FOR_PAYMENT");
            return plan;
        });
        assertEquals(Outcome.CONFIRMED, service.ensurePaidOrderConfirmed(ORDER));
        verify(userPlanService, times(2)).activateCommercePlan(any(UserPlan.class));
        // activateCommercePlan settles the hold of a plan it activates.
        verify(stockHoldService, never()).onPlanActivated(any(), any());
    }

    // ------------------------------------------------------------------ late payment

    private void cancelledUnpaid() {
        order.setStatus(CommerceOrderStatus.CANCELLED.name());
        order.setCancelReason(CommerceOrderPaymentService.REASON_PAYMENT_EXPIRED);
        order.setCancelledAt(new java.util.Date());
        // The expiry voided the pending tender.
        when(tenderRepository.settlePending(eq(ORDER), anyString(), any(), any())).thenReturn(0);
    }

    @Test
    void aLatePaymentWhoseStockWasTakenAgainConfirmsTheCancelledOrder() {
        cancelledUnpaid();
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);

        assertEquals(Outcome.CONFIRMED, service.onPaymentLogPaid("log-1"));

        assertEquals("CONFIRMED", order.getStatus());
        assertEquals("PAID", order.getPaymentStatus());
        assertNull(order.getCancelReason());
        assertNull(order.getCancelledAt());
        verify(writer).history(order, CommerceOrderStatus.CANCELLED, CommerceOrderStatus.CONFIRMED, null,
                CommerceOrderPaymentService.NOTE_LATE_PAYMENT);
        // A new RECEIVED tender, because the old one is VOID.
        ArgumentCaptor<CommerceOrderTender> tender = ArgumentCaptor.forClass(CommerceOrderTender.class);
        verify(tenderRepository).save(tender.capture());
        assertEquals("RECEIVED", tender.getValue().getStatus());
        assertEquals(new BigDecimal("1500.00"), tender.getValue().getAmount());
        assertNotNull(tender.getValue().getReceivedAt());
        verifyNoInteractions(refundHook);
        verify(stockHoldService, never()).restoreForPlan(any(), any());
    }

    @Test
    void aLatePaymentWithNoStockLeftStaysCancelledAsOversoldPaidAndARefundIsDue() {
        cancelledUnpaid();
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", true);

        assertEquals(Outcome.OVERSOLD_PAID, service.onPaymentLogPaid("log-1"));

        assertEquals("CANCELLED", order.getStatus());
        assertEquals(CommerceOrderPaymentService.REASON_OVERSOLD_PAID, order.getCancelReason());
        assertEquals("PAID", order.getPaymentStatus());
        assertEquals(new BigDecimal("1500.00"), order.getAmountPaid());
        assertNull(order.getConfirmedAt());
        // The line that got its stock gives it back; the oversold line took nothing and gives nothing.
        verify(stockHoldService).restoreForPlan("plan-1", null);
        verify(stockHoldService, never()).restoreForPlan(eq("plan-2"), any());
        verify(stockHoldService).closeWithoutGiveBack("plan-2", null, "OVERSOLD_PAID");
        verify(stockHoldService, never()).closeWithoutGiveBack(eq("plan-1"), any(), any());
        verify(refundHook).refundOversoldPaidOrder("inst-1", ORDER, "ORD-000007", new BigDecimal("1500.00"), "INR");
        verify(writer).history(eq(order), eq(CommerceOrderStatus.CANCELLED), eq(CommerceOrderStatus.CANCELLED),
                isNull(), org.mockito.ArgumentMatchers.startsWith("OVERSOLD_PAID"));

        // And it is settled: the next delivery does nothing, and refunds nothing a second time.
        assertEquals(Outcome.ALREADY_SETTLED, service.onPaymentLogPaid("log-2"));
        verify(refundHook, times(1)).refundOversoldPaidOrder(any(), any(), any(), any(), any());
    }

    @Test
    void anOversoldHoldOnAnOrderThatWasStillWaitingCancelsIt() {
        paidInFull();
        hold("plan-1", "SOLD", true);

        assertEquals(Outcome.OVERSOLD_PAID, service.ensurePaidOrderConfirmed(ORDER));

        assertEquals("CANCELLED", order.getStatus());
        assertEquals("OVERSOLD_PAID", order.getCancelReason());
        assertNotNull(order.getCancelledAt());
        verify(stockHoldService).closeWithoutGiveBack("plan-1", null, "OVERSOLD_PAID");
        verify(stockHoldService).restoreForPlan("plan-2", null);
        verify(writer).history(eq(order), eq(CommerceOrderStatus.PENDING_PAYMENT), eq(CommerceOrderStatus.CANCELLED),
                isNull(), anyString());
        verify(refundHook).refundOversoldPaidOrder(any(), any(), any(), any(), any());
    }

    @Test
    void aFailingRefundHookDoesNotUndoWhatWasDecided() {
        paidInFull();
        hold("plan-1", "SOLD", true);
        org.mockito.Mockito.doThrow(new IllegalStateException("down")).when(refundHook)
                .refundOversoldPaidOrder(any(), any(), any(), any(), any());
        assertEquals(Outcome.OVERSOLD_PAID, service.ensurePaidOrderConfirmed(ORDER));
        assertEquals("OVERSOLD_PAID", order.getCancelReason());
    }

    // ------------------------------------------------------------------ expiry

    @Test
    void anUnpaidOrderIsCancelledWhenItsPaymentWindowCloses() {
        log("log-1", "PAYMENT_PENDING", "500.00");
        log("log-2", "FAILED", "1000.00");

        assertTrue(service.onHoldExpired(ORDER));

        assertEquals("CANCELLED", order.getStatus());
        assertEquals("PAYMENT_EXPIRED", order.getCancelReason());
        assertNotNull(order.getCancelledAt());
        assertEquals("UNPAID", order.getPaymentStatus());
        verify(stockHoldService).releaseForOrder("log-1");
        verify(legacyRepository).cancelPendingPlans(List.of("plan-1", "plan-2"));
        verify(tenderRepository).settlePending(ORDER, CommerceOrderTender.STATUS_VOID, null, null);
        verify(writer).history(order, CommerceOrderStatus.PENDING_PAYMENT, CommerceOrderStatus.CANCELLED, null,
                "PAYMENT_EXPIRED");
        // The payment logs are left as they are: a payment that still arrives can be claimed.
        verify(legacyRepository, never()).markLogsPending(any(), any());
        verifyNoInteractions(userPlanService, refundHook);
    }

    @Test
    void expiryIsIdempotent() {
        log("log-1", "PAYMENT_PENDING", "1500.00");
        assertTrue(service.onHoldExpired(ORDER));
        assertFalse(service.onHoldExpired(ORDER));
        verify(stockHoldService, times(1)).releaseForOrder(any());
        verify(writer, times(1)).history(any(), any(), any(), any(), any());
    }

    @Test
    void anOrderWhoseMoneyHasArrivedIsNotCancelledByTheExpiry() {
        paidInFull();
        assertFalse(service.onHoldExpired(ORDER));
        assertEquals("PENDING_PAYMENT", order.getStatus());
        verify(stockHoldService, never()).releaseForOrder(any());
        verify(legacyRepository, never()).cancelPendingPlans(any());
        verify(orderRepository, never()).save(any());
    }

    @Test
    void aConfirmedOrACancelledOrderIsNotTouchedByTheExpiry() {
        order.setStatus("CONFIRMED");
        assertFalse(service.onHoldExpired(ORDER));
        order.setStatus("CANCELLED");
        assertFalse(service.onHoldExpired(ORDER));
        assertFalse(service.onHoldExpired("no-such-order"));
        assertFalse(service.onHoldExpired(null));
        verify(stockHoldService, never()).releaseForOrder(any());
        verify(orderRepository, never()).save(any());
    }

    @Test
    void expiryThenALatePaymentConfirmsOnce() {
        log("log-1", "PAYMENT_PENDING", "500.00");
        log("log-2", "PAYMENT_PENDING", "1000.00");
        assertTrue(service.onHoldExpired(ORDER));
        // The payment arrives: both logs are claimed PAID, the stock is taken again.
        logs.clear();
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);
        when(tenderRepository.settlePending(eq(ORDER), eq(CommerceOrderTender.STATUS_RECEIVED), any(), any()))
                .thenReturn(0);

        assertEquals(Outcome.CONFIRMED, service.onPaymentLogPaid("log-1"));
        assertEquals(Outcome.ALREADY_SETTLED, service.onPaymentLogPaid("log-2"));
        assertEquals("CONFIRMED", order.getStatus());
        verify(writer, times(1)).history(order, CommerceOrderStatus.CANCELLED, CommerceOrderStatus.CONFIRMED, null,
                CommerceOrderPaymentService.NOTE_LATE_PAYMENT);
    }
    // ------------------------------------------------------------------ review round 4

    /** A transaction manager that really opens transactions on the thread, without a database. */
    private static final class CountingTransactions
            extends org.springframework.transaction.support.AbstractPlatformTransactionManager {
        int open;
        int peak;

        @Override
        protected Object doGetTransaction() {
            return new Object();
        }

        @Override
        protected void doBegin(Object transaction, org.springframework.transaction.TransactionDefinition definition) {
            open++;
            peak = Math.max(peak, open);
        }

        @Override
        protected void doCommit(org.springframework.transaction.support.DefaultTransactionStatus status) {
            open--;
        }

        @Override
        protected void doRollback(org.springframework.transaction.support.DefaultTransactionStatus status) {
            open--;
        }
    }

    @Test
    void onThePaymentPathPlansAreActivatedWithNoTransactionOpen_soTheStockStepNeedsNoSecondConnection() {
        CountingTransactions transactions = new CountingTransactions();
        CommerceOrderPaymentService real = new CommerceOrderPaymentService(orderRepository, lineRepository,
                tenderRepository, legacyRepository, writer, stockHoldService, userPlanService, refundHook,
                transactions);
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);
        List<Boolean> insideATransaction = new ArrayList<>();
        org.mockito.Mockito.doAnswer(call -> {
            insideATransaction.add(org.springframework.transaction.support.TransactionSynchronizationManager
                    .isActualTransactionActive());
            return null;
        }).when(userPlanService).activateCommercePlan(any(UserPlan.class));
        org.mockito.Mockito.doAnswer(call -> {
            insideATransaction.add(org.springframework.transaction.support.TransactionSynchronizationManager
                    .isActualTransactionActive());
            return null;
        }).when(stockHoldService).onPlanActivated(any(UserPlan.class), isNull());

        assertEquals(Outcome.CONFIRMED, real.ensurePaidOrderConfirmed(ORDER));

        // Two plans, each activated and (being ACTIVE already) its stock step run again: four
        // calls, none inside a transaction. StockHoldService defers its work to the commit of
        // a surrounding transaction and then opens one of its own while the first still holds
        // its connection; with none around it runs at once.
        assertEquals(List.of(false, false, false, false), insideATransaction);
        assertEquals(1, transactions.peak, "never two transactions open on the thread");
        assertEquals(0, transactions.open);
    }

    @Test
    void insideACallersTransactionEachPlanStillGetsATransactionOfItsOwn() {
        CountingTransactions transactions = new CountingTransactions();
        CommerceOrderPaymentService real = new CommerceOrderPaymentService(orderRepository, lineRepository,
                tenderRepository, legacyRepository, writer, stockHoldService, userPlanService, refundHook,
                transactions);
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);
        List<Boolean> insideATransaction = new ArrayList<>();
        org.mockito.Mockito.doAnswer(call -> {
            insideATransaction.add(org.springframework.transaction.support.TransactionSynchronizationManager
                    .isActualTransactionActive());
            return null;
        }).when(userPlanService).activateCommercePlan(any(UserPlan.class));

        new org.springframework.transaction.support.TransactionTemplate(transactions)
                .executeWithoutResult(status -> assertEquals(Outcome.CONFIRMED, real.ensurePaidOrderConfirmed(ORDER)));

        // There the stock step must run at the commit of the plan's own transaction, or the
        // order could not be settled in the same call.
        assertEquals(List.of(true, true), insideATransaction);
    }

    @Test
    void anUnpaidOrderThatIsCancelledGivesItsCouponUseBack_once() {
        order.setAppliedCouponDiscountId("acd-1");
        order.setCouponCode("FIRST100");
        log("log-1", "PAYMENT_PENDING", "1500.00");

        assertTrue(service.onHoldExpired(ORDER));
        assertFalse(service.onHoldExpired(ORDER));

        verify(legacyRepository, times(1)).giveCouponUseBack("acd-1");
    }

    @Test
    void anOrderWithoutACouponOrOneThatIsPaidGivesNothingBack() {
        log("log-1", "PAYMENT_PENDING", "1500.00");
        assertTrue(service.onHoldExpired(ORDER));
        verify(legacyRepository, never()).giveCouponUseBack(any());

        order.setStatus("PENDING_PAYMENT");
        order.setAppliedCouponDiscountId("acd-1");
        logs.clear();
        paidInFull();
        assertFalse(service.onHoldExpired(ORDER));
        verify(legacyRepository, never()).giveCouponUseBack(any());
    }

    @Test
    void aLatePaymentTakesTheCouponUseAgain_andSaysSoWhenTheCouponIsThenOverItsLimit() {
        cancelledUnpaid();
        order.setAppliedCouponDiscountId("acd-1");
        order.setCouponCode("FIRST100");
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);
        when(legacyRepository.takeCouponUseAgain("acd-1")).thenReturn(0);
        when(legacyRepository.couponIsLimited("acd-1")).thenReturn(1L);

        assertEquals(Outcome.CONFIRMED, service.onPaymentLogPaid("log-1"));

        verify(legacyRepository).takeCouponUseAgain("acd-1");
        verify(writer).history(order, CommerceOrderStatus.CANCELLED, CommerceOrderStatus.CONFIRMED, null,
                "LATE_PAYMENT; coupon FIRST100 is over its limit by one");
    }

    @Test
    void anOrderInTimeConfirmsWithoutTouchingTheCouponAgain() {
        order.setAppliedCouponDiscountId("acd-1");
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);

        assertEquals(Outcome.CONFIRMED, service.onPaymentLogPaid("log-1"));

        verify(legacyRepository, never()).takeCouponUseAgain(any());
        verify(legacyRepository, never()).giveCouponUseBack(any());
    }

    // ------------------------------------------------------------------ payable (M-4)

    @Test
    void anOrderWhoseStockIsHeldAndWhoseTimeIsNotOverIsPayable() {
        order.setHoldExpiresAt(new java.util.Date(System.currentTimeMillis() + 600_000L));
        hold("plan-1", "HELD", false);
        hold("plan-2", "HELD", false);

        assertTrue(service.ensurePayable(ORDER));

        assertEquals("PENDING_PAYMENT", order.getStatus());
        verify(orderRepository).lockById(ORDER);
        verify(orderRepository, never()).save(any());
    }

    @Test
    void anOrderWhoseStockTheShopperGaveBackIsNotPayable_itIsCancelledInsteadOfOffered() {
        order.setHoldExpiresAt(new java.util.Date(System.currentTimeMillis() + 600_000L));
        log("log-1", "PAYMENT_PENDING", "1500.00");
        hold("plan-1", "HELD", false);
        hold("plan-2", "RELEASED", false);

        assertFalse(service.ensurePayable(ORDER));

        assertEquals("CANCELLED", order.getStatus());
        assertEquals("SHOPPER_RELEASED", order.getCancelReason());
        // What was still held goes back on sale too.
        verify(stockHoldService).releaseForOrder("log-1");
    }

    @Test
    void anOrderPastItsHoldTimeIsNotPayable_evenWhileTheExpiryJobHasNotReachedItsHolds() {
        order.setHoldExpiresAt(new java.util.Date(System.currentTimeMillis() - 1_000L));
        log("log-1", "PAYMENT_PENDING", "1500.00");
        hold("plan-1", "HELD", false);
        hold("plan-2", "HELD", false);

        assertFalse(service.ensurePayable(ORDER));

        assertEquals("CANCELLED", order.getStatus());
        assertEquals("PAYMENT_EXPIRED", order.getCancelReason());
    }

    @Test
    void anOrderThatIsNotWaitingOrWhoseMoneyHasArrivedIsNotPayableAndIsLeftAlone() {
        order.setStatus("CONFIRMED");
        assertFalse(service.ensurePayable(ORDER));
        assertFalse(service.ensurePayable(null));
        assertFalse(service.ensurePayable("no-such-order"));

        order.setStatus("PENDING_PAYMENT");
        order.setHoldExpiresAt(new java.util.Date(System.currentTimeMillis() - 1_000L));
        paidInFull();
        assertFalse(service.ensurePayable(ORDER));
        // The money is in: the confirm step owns the order, the payable check cancels nothing.
        assertEquals("PENDING_PAYMENT", order.getStatus());
        verify(orderRepository, never()).save(any());
    }

    // ------------------------------------------------------------------ buyer messages (WP-33)

    private vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents events(
            CommerceOrderPaymentService target) {
        vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents events =
                mock(vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents.class);
        target.setEvents(events);
        return events;
    }

    private static List<vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents.OrderEvent>
            emitted(vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents events) {
        ArgumentCaptor<vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents.OrderEvent>
                captor = ArgumentCaptor.forClass(
                vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents.OrderEvent.class);
        verify(events, org.mockito.Mockito.atLeast(0)).afterCommit(captor.capture());
        return captor.getAllValues();
    }

    private static void assertOrderEvent(String type,
            vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents.OrderEvent event) {
        assertEquals(type, event.type());
        assertEquals("inst-1", event.instituteId());
        assertEquals(ORDER, event.orderId());
        assertEquals("ORD-000007", event.orderNumber());
        assertEquals("", event.refId());
        assertTrue(event.notifyCustomer());
    }

    @Test
    void aPaidSettleTellsTheBuyerTheOrderIsConfirmed_once() {
        var events = events(service);
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);

        assertEquals(Outcome.CONFIRMED, service.onPaymentLogPaid("log-2"));
        var sent = emitted(events);
        assertEquals(1, sent.size());
        assertOrderEvent("ORDER_CONFIRMED", sent.get(0));

        // A replay settles nothing and tells nothing.
        assertEquals(Outcome.ALREADY_SETTLED, service.onPaymentLogPaid("log-1"));
        assertEquals(Outcome.ALREADY_SETTLED, service.ensurePaidOrderConfirmed(ORDER));
        assertEquals(1, emitted(events).size());
    }

    @Test
    void aLatePaymentThatReopensACancelledOrderTellsTheBuyerItIsConfirmed() {
        var events = events(service);
        cancelledUnpaid();
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);

        assertEquals(Outcome.CONFIRMED, service.onPaymentLogPaid("log-1"));
        var sent = emitted(events);
        assertEquals(1, sent.size());
        assertOrderEvent("ORDER_CONFIRMED", sent.get(0));
    }

    @Test
    void anOversoldPaidOrderTellsTheBuyerItIsCancelled_neverConfirmed() {
        var events = events(service);
        cancelledUnpaid();
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", true);
        assertEquals(Outcome.OVERSOLD_PAID, service.onPaymentLogPaid("log-1"));
        var sent = emitted(events);
        assertEquals(1, sent.size());
        assertOrderEvent("ORDER_CANCELLED", sent.get(0));
        // The planner reads the reason from the order.
        assertEquals(CommerceOrderPaymentService.REASON_OVERSOLD_PAID, order.getCancelReason());
        assertEquals(Outcome.ALREADY_SETTLED, service.onPaymentLogPaid("log-2"));
        assertEquals(1, emitted(events).size());
    }

    @Test
    void anOversoldHoldOnAWaitingOrderTellsTheBuyerItIsCancelled() {
        var events = events(service);
        paidInFull();
        hold("plan-1", "SOLD", true);
        assertEquals(Outcome.OVERSOLD_PAID, service.ensurePaidOrderConfirmed(ORDER));
        var sent = emitted(events);
        assertEquals(1, sent.size());
        assertOrderEvent("ORDER_CANCELLED", sent.get(0));
        assertEquals("OVERSOLD_PAID", order.getCancelReason());
    }

    @Test
    void noMessageWhenTheOrderIsNotSettled() {
        var events = events(service);
        log("log-1", "PAYMENT_PENDING", "500.00");
        log("log-2", "FAILED", "1000.00");
        assertEquals(Outcome.NOT_PAID_YET, service.ensurePaidOrderConfirmed(ORDER));

        logs.clear();
        log("log-1", "PAID", "500.00");
        log("log-2", "PAYMENT_PENDING", "1000.00");
        assertEquals(Outcome.PARTLY_PAID, service.onPaymentLogPaid("log-1"));

        logs.clear();
        log("log-1", "PAID", "500.00");
        log("log-2", "PAID", "999.00");
        assertEquals(Outcome.REFUSED_MISMATCH, service.onPaymentLogPaid("log-1"));

        logs.clear();
        paidInFull();
        assertEquals(Outcome.REFUSED_MISMATCH, service.onPaymentLogPaid("log-1", "order_gw_1", 100L));

        hold("plan-1", "HELD", false);
        hold("plan-2", "SOLD", false);
        assertEquals(Outcome.STOCK_NOT_SETTLED, service.ensurePaidOrderConfirmed(ORDER));

        when(legacyRepository.findGroupIdOfLog("course-log")).thenReturn(null);
        assertEquals(Outcome.NOT_A_COMMERCE_ORDER, service.onPaymentLogPaid("course-log"));

        verifyNoInteractions(events);
    }

    @Test
    void theConfirmedEventIsWrittenInsideTheSettleTransaction() {
        CountingTransactions transactions = new CountingTransactions();
        CommerceOrderPaymentService real = new CommerceOrderPaymentService(orderRepository, lineRepository,
                tenderRepository, legacyRepository, writer, stockHoldService, userPlanService, refundHook,
                transactions);
        var events = events(real);
        List<Boolean> insideATransaction = new ArrayList<>();
        org.mockito.Mockito.doAnswer(call -> {
            insideATransaction.add(org.springframework.transaction.support.TransactionSynchronizationManager
                    .isActualTransactionActive());
            // The order change is already made when its event is written.
            assertEquals("CONFIRMED", order.getStatus());
            return null;
        }).when(events).afterCommit(any());
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);

        assertEquals(Outcome.CONFIRMED, real.ensurePaidOrderConfirmed(ORDER));
        assertEquals(List.of(true), insideATransaction);
    }

    @Test
    void withoutTheEventsBeanTheSettleWorksAsBefore() {
        paidInFull();
        hold("plan-1", "SOLD", false);
        hold("plan-2", "SOLD", false);
        assertEquals(Outcome.CONFIRMED, service.ensurePaidOrderConfirmed(ORDER));
        assertEquals("CONFIRMED", order.getStatus());
    }
}
