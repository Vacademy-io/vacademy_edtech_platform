package vacademy.io.admin_core_service.features.learner.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentHooks;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceStrategy;
import vacademy.io.admin_core_service.features.product_page.service.ProductPageAutoLoginService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The enrol route also confirms gateway payments ({@code completeGatewayPaymentConfirmation}).
 * A payment of a shop order is confirmed only by the shop's own routes and gets no answer
 * there. A course payment is confirmed exactly as before.
 */
class LearnerEnrollShopPaymentRefusedTest {

    private LearnerEnrollRequestService service;
    private PaymentLogRepository paymentLogs;
    private PaymentLogService paymentLogService;
    private AuthService authService;
    private ProductPageAutoLoginService autoLogin;
    private CommercePaymentHooks hooks;
    private PaymentServiceStrategy gateway;

    @BeforeEach
    void setUp() {
        service = new LearnerEnrollRequestService();
        paymentLogs = mock(PaymentLogRepository.class);
        paymentLogService = mock(PaymentLogService.class);
        authService = mock(AuthService.class);
        autoLogin = mock(ProductPageAutoLoginService.class);
        hooks = mock(CommercePaymentHooks.class);
        gateway = mock(PaymentServiceStrategy.class);
        InstitutePaymentGatewayMappingService mappings = mock(InstitutePaymentGatewayMappingService.class);
        when(mappings.findInstitutePaymentGatewaySpecifData(anyString(), anyString())).thenReturn(Map.of());
        when(gateway.verifyClientPaymentConfirmation(any(), any())).thenReturn("order_rzp1");
        ReflectionTestUtils.setField(service, "institutePaymentGatewayMappingService", mappings);
        ReflectionTestUtils.setField(service, "paymentLogRepository", paymentLogs);
        ReflectionTestUtils.setField(service, "paymentLogService", paymentLogService);
        ReflectionTestUtils.setField(service, "authService", authService);
        ReflectionTestUtils.setField(service, "autoLoginService", autoLogin);
        ReflectionTestUtils.setField(service, "commercePaymentHooks", hooks);
        UserDTO account = new UserDTO();
        account.setId("victim-user");
        account.setEmail("victim@example.com");
        when(authService.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(account));
    }

    private static PaymentLog log(String groupId) {
        UserPlan plan = new UserPlan();
        plan.setId("plan-1");
        PaymentLog log = new PaymentLog();
        log.setId("log-1");
        log.setUserId("victim-user");
        log.setPaymentAmount(10.0);
        log.setPaymentGroupId(groupId);
        log.setUserPlan(plan);
        log.setCreatedAt(java.time.LocalDateTime.now());
        return log;
    }

    private Object confirm() {
        LearnerEnrollRequestDTO request = new LearnerEnrollRequestDTO();
        request.setInstituteId("inst-1");
        PaymentInitiationRequestDTO payment = new PaymentInitiationRequestDTO();
        payment.setVendor("RAZORPAY");
        return ReflectionTestUtils.invokeMethod(service, "completeGatewayPaymentConfirmation", request, payment,
                gateway);
    }

    @Test
    void aPaidShopOrderPresentedToTheEnrolRouteIsRefused_noAccountIsReadAndNoLoginCodeIsIssued() {
        PaymentLog shop = log("group-of-a-shop-order");
        when(paymentLogs.findAllByOrderIdInJson("order_rzp1")).thenReturn(List.of(shop));
        when(hooks.isCommerceLog(shop)).thenReturn(true);

        VacademyException refused = assertThrows(VacademyException.class, this::confirm);

        assertNotNull(refused.getMessage());
        verifyNoInteractions(authService, autoLogin);
        verify(paymentLogService, never()).updatePaymentLog(anyString(), anyString(), anyString());
    }

    @Test
    void aCoursePaymentIsConfirmedAsBefore_andALogWithoutAGroupAsksCommerceNothing() {
        PaymentLog course = log(null);
        when(paymentLogs.findAllByOrderIdInJson("order_rzp1")).thenReturn(List.of(course));

        LearnerEnrollResponseDTO answer = (LearnerEnrollResponseDTO) confirm();

        assertEquals("plan-1", answer.getUserPlanId());
        assertEquals("victim-user", answer.getUser().getId());
        verify(paymentLogService).updatePaymentLog("log-1", "PAID", "inst-1");
        verifyNoInteractions(hooks);
    }

    @Test
    void aCoursePaymentInAGroupCostsOneKeyReadAndIsConfirmedAsBefore() {
        PaymentLog course = log("group-of-two-courses");
        when(paymentLogs.findAllByOrderIdInJson("order_rzp1")).thenReturn(List.of(course));
        when(hooks.isCommerceLog(course)).thenReturn(false);

        LearnerEnrollResponseDTO answer = (LearnerEnrollResponseDTO) confirm();

        assertEquals("plan-1", answer.getUserPlanId());
        verify(paymentLogService).updatePaymentLog("log-1", "PAID", "inst-1");
    }
}
