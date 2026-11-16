package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.commerce.common.CommercePlans;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommerceOrderPaymentPort;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGuard;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentHooks;
import vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityRecorder;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The commerce hooks of the legacy payment code: a shop order line gets activation
 * and one call to the order code, and none of the course logic; a course payment takes none of
 * the new code.
 */
class PaymentLogServiceCommerceOrderTest {

    private static final String SHOP_GROUP = "group-shop";
    private static final String COURSE_GROUP = "group-course";

    private CommercePaymentGuard guard;
    private CommerceOrderPaymentPort orders;
    private PaymentLogRepository logs;
    private UserPlanService userPlanService;
    private InvoiceService invoiceService;
    private UserAccountLedgerService ledger;
    private LiveActivityRecorder liveActivity;
    private WorkflowTriggerService workflows;
    private PaymentNotificatonService notifications;
    private PaymentLogService service;

    @BeforeEach
    void setUp() {
        guard = mock(CommercePaymentGuard.class);
        when(guard.orderIdOfGroup(SHOP_GROUP)).thenReturn("order-1");
        when(guard.isCommerceLog(any())).thenAnswer(call -> {
            PaymentLog log = call.getArgument(0);
            return log != null && SHOP_GROUP.equals(log.getPaymentGroupId());
        });
        orders = mock(CommerceOrderPaymentPort.class);
        logs = mock(PaymentLogRepository.class);
        userPlanService = mock(UserPlanService.class);
        invoiceService = mock(InvoiceService.class);
        ledger = mock(UserAccountLedgerService.class);
        liveActivity = mock(LiveActivityRecorder.class);
        workflows = mock(WorkflowTriggerService.class);
        notifications = mock(PaymentNotificatonService.class);

        service = new PaymentLogService();
        ReflectionTestUtils.setField(service, "commercePaymentHooks", new CommercePaymentHooks(guard, orders));
        ReflectionTestUtils.setField(service, "commercePlans",
                new CommercePlans(mock(CommerceVariantRepository.class)));
        ReflectionTestUtils.setField(service, "paymentLogRepository", logs);
        ReflectionTestUtils.setField(service, "userPlanService", userPlanService);
        ReflectionTestUtils.setField(service, "invoiceService", invoiceService);
        ReflectionTestUtils.setField(service, "userAccountLedgerService", ledger);
        ReflectionTestUtils.setField(service, "liveActivityRecorder", liveActivity);
        ReflectionTestUtils.setField(service, "workflowTriggerService", workflows);
        ReflectionTestUtils.setField(service, "paymentNotificatonService", notifications);
        ReflectionTestUtils.setField(service, "paymentSettingService", mock(PaymentSettingService.class));
    }

    private static PaymentLog log(String id, String groupId) {
        UserPlan plan = new UserPlan();
        plan.setId("plan-" + id);
        plan.setUserId("buyer-1");
        plan.setEnrollInviteId("invite-" + id);
        PaymentLog log = new PaymentLog();
        log.setId(id);
        log.setUserId("buyer-1");
        log.setPaymentAmount(499.0);
        log.setPaymentGroupId(groupId);
        log.setUserPlan(plan);
        return log;
    }

    // ── handlePostPaymentLogic ───────────────────────────────────────────────

    @Test
    void aPaidShopLineIsActivatedAndTheOrderIsToldAndNoCourseLogicRuns() {
        PaymentLog shop = log("log-1", SHOP_GROUP);

        ReflectionTestUtils.invokeMethod(service, "handlePostPaymentLogic", shop, "PAID", "inst-1");

        verify(userPlanService).activateCommercePlan(shop.getUserPlan());
        verify(orders).onPaymentLogPaid("log-1");
        // None of the three legacy hooks, and nothing they lead to.
        verify(userPlanService, never()).applyOperationsOnFirstPayment(any());
        verifyNoInteractions(invoiceService, ledger, liveActivity, workflows, notifications);
    }

    @Test
    void aFailedShopLineOnlyMarksThePlan() {
        PaymentLog shop = log("log-1", SHOP_GROUP);

        ReflectionTestUtils.invokeMethod(service, "handlePostPaymentLogic", shop, "FAILED", "inst-1");

        verify(userPlanService).markCommercePlanPaymentFailed(shop.getUserPlan());
        verify(userPlanService, never()).activateCommercePlan(any());
        verifyNoInteractions(orders, invoiceService, ledger, liveActivity, workflows, notifications);
    }

    @Test
    void aCourseLogWithoutAGroupAsksCommerceNothing() {
        PaymentLog course = log("log-c", null);
        course.setUserPlan(null); // the failure flow of the legacy code returns at once without a plan

        ReflectionTestUtils.invokeMethod(service, "handlePostPaymentLogic", course, "FAILED", "inst-1");

        // No commerce read at all, and the legacy path ran: its first step is the live feed.
        verifyNoInteractions(guard, orders);
        verify(liveActivity).recordAfterCommit(any());
    }

    @Test
    void aCourseLogInACourseGroupCostsOneReadAndStaysOnTheLegacyPath() {
        PaymentLog course = log("log-c", COURSE_GROUP);
        course.setUserPlan(null);

        ReflectionTestUtils.invokeMethod(service, "handlePostPaymentLogic", course, "FAILED", "inst-1");

        verify(guard, times(1)).isCommerceLog(course);
        verifyNoInteractions(orders);
        verify(liveActivity).recordAfterCommit(any());
        verify(userPlanService, never()).markCommercePlanPaymentFailed(any());
    }

    // ── handlePostPaymentLogicForSyncPayment ─────────────────────────────────

    @Test
    void theSynchronousHookActivatesAShopLineAndTellsTheOrder() {
        PaymentLog shop = log("log-1", SHOP_GROUP);

        ReflectionTestUtils.invokeMethod(service, "handlePostPaymentLogicForSyncPayment", shop, "inst-1");

        verify(userPlanService).activateCommercePlan(shop.getUserPlan());
        verify(orders).onPaymentLogPaid("log-1");
        verify(userPlanService, never()).applyOperationsOnFirstPayment(any());
        verifyNoInteractions(invoiceService, ledger, liveActivity);
    }

    // ── updatePaymentLogsByOrderId: the legacy way in is closed for a shop order ──

    @Test
    void theLegacyUpdateByOrderReferenceRefusesTheLogsOfAShopOrder() {
        PaymentLog shop = log("log-1", SHOP_GROUP);
        when(logs.findAllByOrderIdInOriginalRequest("order-1")).thenReturn(List.of(shop));

        service.updatePaymentLogsByOrderId("order-1", "PAID", "inst-1");

        // Nothing is written and nothing runs: the notes alone never pay a shop order.
        verify(logs, never()).markPaidIfNotAlready(anyString(), anyString(), anyString());
        verify(logs, never()).updatePaymentStatusIfNotPaid(anyString(), anyString(), anyString());
        verifyNoInteractions(userPlanService, orders, invoiceService, ledger, liveActivity);
    }

    @Test
    void theLegacyUpdateOfACourseLogIsUnchangedAndAsksCommerceNothing() {
        PaymentLog course = log("log-c", null);
        when(logs.findAllByOrderIdInOriginalRequest("log-c")).thenReturn(List.of(course));
        when(logs.markPaidIfNotAlready("log-c", "PAID", "SUCCESS")).thenReturn(0); // a replay: no side effects

        service.updatePaymentLogsByOrderId("log-c", "PAID", "inst-1");

        verify(logs).markPaidIfNotAlready("log-c", "PAID", "SUCCESS");
        verifyNoInteractions(guard, orders);
    }

    // ── markCommerceLogsPaid / Failed ────────────────────────────────────────

    @Test
    void theCommerceClaimRunsInIdOrderAndDoesNothingElse_noWorkIsLeftForAfterTheCommit() {
        PaymentLog a = log("log-a", SHOP_GROUP);
        PaymentLog b = log("log-b", SHOP_GROUP);
        when(logs.findAllById(any())).thenReturn(List.of(b, a));
        when(logs.markPaidIfNotAlready(anyString(), anyString(), anyString())).thenReturn(1);

        List<String> claimed = service.markCommerceLogsPaid(List.of("log-b", "log-a"));

        assertEquals(List.of("log-a", "log-b"), claimed);
        InOrder order = inOrder(logs);
        order.verify(logs).markPaidIfNotAlready("log-a", "PAID", "SUCCESS");
        order.verify(logs).markPaidIfNotAlready("log-b", "PAID", "SUCCESS");
        // The plans are activated and the order confirmed by the order code, after this
        // transaction has given its connection back: nothing here may hold it and ask for
        // another (five payments in one second used to wait on the pool that way).
        verifyNoInteractions(userPlanService, orders);
        assertEquals("PAID", a.getPaymentStatus());
        assertEquals("SUCCESS", b.getStatus());
        verifyNoInteractions(invoiceService, ledger, liveActivity, workflows, notifications);
    }

    @Test
    void aReplayClaimsNothingAndRunsNoSideEffect() {
        PaymentLog a = log("log-a", SHOP_GROUP);
        when(logs.findAllById(any())).thenReturn(List.of(a));
        when(logs.markPaidIfNotAlready(anyString(), anyString(), anyString())).thenReturn(0);

        assertTrue(service.markCommerceLogsPaid(List.of("log-a")).isEmpty());

        verifyNoInteractions(userPlanService, orders);
    }

    @Test
    void aLogThatIsNoShopLineIsNeverClaimedByTheCommerceMethods() {
        PaymentLog course = log("log-c", COURSE_GROUP);
        when(logs.findAllById(any())).thenReturn(List.of(course));

        assertTrue(service.markCommerceLogsPaid(List.of("log-c")).isEmpty());
        assertTrue(service.markCommerceLogsFailed(List.of("log-c")).isEmpty());

        verify(logs, never()).markPaidIfNotAlready(anyString(), anyString(), anyString());
        verify(logs, never()).updatePaymentStatusIfNotPaid(anyString(), anyString(), anyString());
        verifyNoInteractions(userPlanService, orders);
    }

    @Test
    void aFailedAttemptThenACaptureConfirmsOnceAndNeverCancels() {
        PaymentLog a = log("log-a", SHOP_GROUP);
        when(logs.findAllById(any())).thenReturn(List.of(a));
        when(logs.updatePaymentStatusIfNotPaid("log-a", "FAILED", "PAID")).thenReturn(1);
        when(logs.markPaidIfNotAlready("log-a", "PAID", "SUCCESS")).thenReturn(1);

        assertEquals(List.of("log-a"), service.markCommerceLogsFailed(List.of("log-a")));
        verify(userPlanService).markCommercePlanPaymentFailed(a.getUserPlan());
        verifyNoInteractions(orders); // a failed attempt tells the order nothing: no cancel, no release

        assertEquals(List.of("log-a"), service.markCommerceLogsPaid(List.of("log-a")));
        verify(logs).markPaidIfNotAlready("log-a", "PAID", "SUCCESS");
        verify(userPlanService, never()).activateCommercePlan(any());
        verifyNoInteractions(orders);
    }

    @Test
    void anOrderOfOneLineGetsItsGroupToo() {
        PaymentLog single = log("log-1", null);
        when(logs.findAllById(any())).thenReturn(List.of(single));

        assertEquals(1, service.assignCommercePaymentGroup(SHOP_GROUP, List.of("log-1")));

        assertEquals(SHOP_GROUP, single.getPaymentGroupId());
        verify(logs).save(single);
    }
}
