package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityDedupeKeys;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityRecorder;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityEvent;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityActorType;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A payment staff record by hand (offline / manual) reaches the live feed as the same PAYMENT
 * event the gateway writes, marked mode OFFLINE; pending and failed ones do not.
 */
class OfflinePaymentLiveActivityTest {

    private PaymentLogService service;
    private LiveActivityRecorder recorder;
    private PaymentLog paymentLog;

    @BeforeEach
    void setUp() {
        service = new PaymentLogService();
        recorder = mock(LiveActivityRecorder.class);
        PaymentLogRepository repo = mock(PaymentLogRepository.class);
        paymentLog = new PaymentLog();
        paymentLog.setId("pl-1");
        paymentLog.setUserId("u-1");
        paymentLog.setPaymentAmount(5000.0);
        paymentLog.setCurrency("INR");
        paymentLog.setVendor("MANUAL");
        paymentLog.setPaymentStatus("PAID");
        when(repo.findById("pl-1")).thenReturn(Optional.of(paymentLog));
        ReflectionTestUtils.setField(service, "paymentLogRepository", repo);
        ReflectionTestUtils.setField(service, "liveActivityRecorder", recorder);
    }

    private LiveActivityEvent recorded() {
        ArgumentCaptor<LiveActivityEvent> c = ArgumentCaptor.forClass(LiveActivityEvent.class);
        verify(recorder, times(1)).recordAfterCommit(c.capture());
        return c.getValue();
    }

    @Test
    @DisplayName("an offline payment recorded as PAID emits one PAYMENT event, mode OFFLINE")
    void offlinePaidEmitsOnce() {
        service.recordOfflinePaymentLiveActivity("pl-1", "inst-1");

        LiveActivityEvent e = recorded();
        assertThat(e.getInstituteId()).isEqualTo("inst-1");
        assertThat(e.getCategory()).isEqualTo(LiveActivityCategory.PAYMENT);
        assertThat(e.getAction()).isEqualTo(LiveActivityAction.PAYMENT_SUCCEEDED);
        assertThat(e.getActorType()).isEqualTo(LiveActivityActorType.LEARNER);
        assertThat(e.getSubjectId()).isEqualTo("u-1");
        assertThat(e.getEntityId()).isEqualTo("pl-1");
        assertThat(e.getPayload()).containsEntry("amount", 5000.0).containsEntry("currency", "INR")
                .containsEntry("vendor", "MANUAL").containsEntry("mode", "OFFLINE");
        // The gateway path's key: one payment log is in the feed at most once, whoever records it.
        assertThat(e.getDedupeKey()).isEqualTo(LiveActivityDedupeKeys.forPayment("pl-1", "PAID"));
    }

    @Test
    @DisplayName("pending, failed and zero-amount payments emit nothing")
    void pendingFailedAndZeroEmitNothing() {
        paymentLog.setPaymentStatus("PAYMENT_PENDING");
        service.recordOfflinePaymentLiveActivity("pl-1", "inst-1");
        paymentLog.setPaymentStatus("FAILED");
        service.recordOfflinePaymentLiveActivity("pl-1", "inst-1");
        paymentLog.setPaymentStatus(null);
        service.recordOfflinePaymentLiveActivity("pl-1", "inst-1");
        paymentLog.setPaymentStatus("PAID");
        paymentLog.setPaymentAmount(0.0);
        service.recordOfflinePaymentLiveActivity("pl-1", "inst-1");
        service.recordOfflinePaymentLiveActivity("pl-1", null);
        service.recordOfflinePaymentLiveActivity("missing", "inst-1");

        verify(recorder, never()).recordAfterCommit(any());
    }

    @Test
    @DisplayName("one payment split across course logs shows its whole amount once")
    void amountOverride() {
        service.recordOfflinePaymentLiveActivity("pl-1", "inst-1", 12500.0);
        assertThat(recorded().getPayload()).containsEntry("amount", 12500.0);
    }

    @Test
    @DisplayName("the gateway path's event is unchanged: no mode, same key")
    void gatewayUnchanged() {
        paymentLog.setVendor("RAZORPAY");
        ReflectionTestUtils.invokeMethod(service, "recordPaymentLiveActivity", paymentLog, "PAID", "inst-1");

        LiveActivityEvent e = recorded();
        assertThat(e.getPayload()).doesNotContainKey("mode")
                .containsEntry("vendor", "RAZORPAY").containsEntry("amount", 5000.0);
        assertThat(e.getDedupeKey()).isEqualTo(LiveActivityDedupeKeys.forPayment("pl-1", "PAID"));
    }

    @Test
    @DisplayName("a feed failure never fails the payment")
    void neverThrows() {
        org.mockito.Mockito.doThrow(new RuntimeException("feed down")).when(recorder).recordAfterCommit(any());
        service.recordOfflinePaymentLiveActivity("pl-1", "inst-1");
    }
}
