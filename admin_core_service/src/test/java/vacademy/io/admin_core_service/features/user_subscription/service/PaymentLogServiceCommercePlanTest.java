package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.commerce.common.CommercePlans;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Shop money stays out of the learner fee ledger, and the synchronous PAID hook only activates. */
class PaymentLogServiceCommercePlanTest {

    private UserAccountLedgerService ledger;
    private UserPlanService userPlanService;
    private InvoiceService invoiceService;
    private PaymentLogService service;

    @BeforeEach
    void setUp() {
        CommerceVariantRepository inviteSessions =
                mock(CommerceVariantRepository.class);
        when(inviteSessions.countVariantsOnInvite("inv-product")).thenReturn(1L);
        ledger = mock(UserAccountLedgerService.class);
        userPlanService = mock(UserPlanService.class);
        invoiceService = mock(InvoiceService.class);

        service = new PaymentLogService();
        ReflectionTestUtils.setField(service, "commercePlans", new CommercePlans(inviteSessions));
        ReflectionTestUtils.setField(service, "userAccountLedgerService", ledger);
        ReflectionTestUtils.setField(service, "paymentSettingService", mock(PaymentSettingService.class));
        ReflectionTestUtils.setField(service, "userPlanService", userPlanService);
        ReflectionTestUtils.setField(service, "invoiceService", invoiceService);
    }

    private static PaymentLog paidLog(String inviteId) {
        UserPlan plan = new UserPlan();
        plan.setId("plan-1");
        plan.setUserId("buyer-1");
        plan.setEnrollInviteId(inviteId);
        PaymentLog log = new PaymentLog();
        log.setId("log-1");
        log.setUserId("buyer-1");
        log.setPaymentAmount(499.0);
        log.setUserPlan(plan);
        return log;
    }

    @Test
    void aProductPaymentIsNotCreditedToTheFeeLedger() {
        ReflectionTestUtils.invokeMethod(service, "recordLedgerCreditForPlanPayment", paidLog("inv-product"), "inst-1");
        verifyNoInteractions(ledger);
    }

    @Test
    void aCoursePaymentStillIs() {
        ReflectionTestUtils.invokeMethod(service, "recordLedgerCreditForPlanPayment", paidLog("inv-course"), "inst-1");
        verify(ledger).recordCreditPayment(eq("buyer-1"), eq("inst-1"), any(), any(), eq("USER_PLAN"),
                eq("plan-1"), eq("log-1"), any(), any());
    }

    @Test
    void theSynchronousPaidHookOnlyActivatesAProductPlan() {
        PaymentLog log = paidLog("inv-product");

        ReflectionTestUtils.invokeMethod(service, "handlePostPaymentLogicForSyncPayment", log, "inst-1");

        verify(userPlanService).activateCommercePlan(log.getUserPlan());
        verify(userPlanService, never()).applyOperationsOnFirstPayment(any());
        // No fee-ledger credit and no course invoice.
        verifyNoInteractions(ledger, invoiceService);
    }

    /**
     * The courier and tracking number of a shop order are written only by the commerce shipment
     * code, so the course endpoint must not write them; a course or book-store payment is
     * updated as before.
     */
    @Test
    void theOldTrackingEndpointRefusesAShopOrderAndStillUpdatesACoursePayment() {
        vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository logs =
                mock(vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository.class);
        ReflectionTestUtils.setField(service, "paymentLogRepository", logs);
        PaymentLog shop = paidLog("inv-product");
        when(logs.findById("log-shop")).thenReturn(java.util.Optional.of(shop));
        PaymentLog course = paidLog("inv-course");
        when(logs.findById("log-course")).thenReturn(java.util.Optional.of(course));

        vacademy.io.admin_core_service.features.user_subscription.dto.UpdatePaymentLogTrackingDTO dto =
                new vacademy.io.admin_core_service.features.user_subscription.dto.UpdatePaymentLogTrackingDTO();
        dto.setPaymentLogId("log-shop");
        dto.setTrackingId("FAKE-123");
        dto.setTrackingSource("Some courier");
        dto.setOrderStatus(vacademy.io.admin_core_service.features.user_subscription.enums.OrderStatusEnum.values()[0].name());

        org.junit.jupiter.api.Assertions.assertThrows(vacademy.io.common.exceptions.VacademyException.class,
                () -> service.updatePaymentLogTracking(dto));
        org.junit.jupiter.api.Assertions.assertNull(shop.getTrackingId());
        verify(logs, never()).save(any());

        dto.setPaymentLogId("log-course");
        service.updatePaymentLogTracking(dto);
        org.junit.jupiter.api.Assertions.assertEquals("FAKE-123", course.getTrackingId());
        verify(logs).save(course);
    }
}
