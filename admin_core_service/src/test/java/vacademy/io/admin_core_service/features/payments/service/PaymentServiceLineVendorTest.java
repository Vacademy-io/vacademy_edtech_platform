package vacademy.io.admin_core_service.features.payments.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A cart line records the gateway its order was paid through, not its own invite's setting. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PaymentServiceLineVendorTest {

    @Mock private PaymentLogService paymentLogService;
    @Mock private PaymentLogRepository paymentLogRepository;
    @Mock private UserPlanService userPlanService;
    @InjectMocks private PaymentService paymentService;

    private UserDTO user;
    private LearnerPackageSessionsEnrollDTO enrollDTO;
    private EnrollInvite deliveryInvite;
    private UserPlan userPlan;

    @BeforeEach
    void setUp() {
        user = new UserDTO();
        user.setId("learner");
        PaymentInitiationRequestDTO request = new PaymentInitiationRequestDTO();
        request.setAmount(40.0);
        request.setCurrency("INR");
        request.setOrderId("parent-log");
        enrollDTO = new LearnerPackageSessionsEnrollDTO();
        enrollDTO.setPaymentInitiationRequest(request);
        deliveryInvite = new EnrollInvite();
        deliveryInvite.setVendor("PHONEPE");
        deliveryInvite.setVendorId("PHONEPE");
        deliveryInvite.setCurrency("INR");
        userPlan = new UserPlan();
        when(paymentLogService.createPaymentLog(anyString(), anyDouble(), any(), any(), any(), any(), any()))
                .thenReturn("child-log");
    }

    private void parentLogPaidThrough(String vendor, String vendorId) {
        PaymentLog parent = new PaymentLog();
        parent.setVendor(vendor);
        parent.setVendorId(vendorId);
        when(paymentLogRepository.findById("parent-log")).thenReturn(Optional.of(parent));
    }

    @Test
    void lineTakesTheOrdersGatewayOverItsOwnInvite() {
        parentLogPaidThrough("RAZORPAY", "RAZORPAY");

        paymentService.handlePaymentWithoutGateway(user, enrollDTO, "inst", deliveryInvite, userPlan,
                Map.of("PARENT_PAYMENT_LOG_ID", "parent-log"));

        verify(paymentLogService).createPaymentLog(eq("learner"), eq(40.0), eq("RAZORPAY"), eq("RAZORPAY"),
                any(), eq(userPlan), any());
    }

    @Test
    void offlineOrderTakesTheOrdersVendorEvenWithoutAVendorId() {
        parentLogPaidThrough("MANUAL", null);

        paymentService.handlePaymentWithoutGateway(user, enrollDTO, "inst", deliveryInvite, userPlan,
                Map.of("PARENT_PAYMENT_LOG_ID", "parent-log"));

        verify(paymentLogService).createPaymentLog(eq("learner"), eq(40.0), eq("MANUAL"), eq(null),
                any(), eq(userPlan), any());
    }

    @Test
    void withoutAParentTheInviteStillDecides() {
        paymentService.handlePaymentWithoutGateway(user, enrollDTO, "inst", deliveryInvite, userPlan, Map.of());

        verify(paymentLogService).createPaymentLog(eq("learner"), eq(40.0), eq("PHONEPE"), eq("PHONEPE"),
                any(), eq(userPlan), any());
    }

    @Test
    void aParentThatCannotBeReadLeavesTheInvitesVendor() {
        when(paymentLogRepository.findById("gone")).thenReturn(Optional.empty());

        paymentService.handlePaymentWithoutGateway(user, enrollDTO, "inst", deliveryInvite, userPlan,
                Map.of("PARENT_PAYMENT_LOG_ID", "gone"));

        verify(paymentLogService).createPaymentLog(eq("learner"), eq(40.0), eq("PHONEPE"), eq("PHONEPE"),
                any(), eq(userPlan), any());
    }
}
