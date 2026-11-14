package vacademy.io.admin_core_service.features.live_activity.core;

import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityEvent;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityActorType;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.util.HashMap;
import java.util.Map;

/**
 * The live-feed event for a payment staff recorded by hand (offline / manual: cash, cheque, bank
 * transfer, a payment taken at enrolment, an installment paid at the desk).
 *
 * <p>Same shape as the gateway path's PAYMENT_SUCCEEDED event in PaymentLogService (amount,
 * currency, vendor; LEARNER actor; the payment log as subject and entity) plus
 * {@code mode = OFFLINE}, so the feed can say how the money came in. The dedupe key is the
 * gateway path's own ({@link LiveActivityDedupeKeys#forPayment}), so one payment log is in the feed
 * at most once whichever path records it.
 *
 * <p>Only a PAID log with a positive amount is announced: pending, failed and zero-amount logs
 * (a free enrolment) give no event.
 */
public final class OfflinePaymentLiveActivity {

    /** payload.mode for a payment staff recorded by hand. */
    public static final String MODE_OFFLINE = "OFFLINE";

    private OfflinePaymentLiveActivity() {
    }

    /**
     * The event to record, or null when there is nothing to announce.
     *
     * @param amountOverride the amount to show instead of the log's own, for one payment recorded
     *                       as several logs (one per course); null to use the log's amount
     */
    public static LiveActivityEvent build(PaymentLog paymentLog, String instituteId, Double amountOverride) {
        if (paymentLog == null || paymentLog.getId() == null) return null;
        if (instituteId == null || instituteId.isBlank()) return null;
        if (!PaymentStatusEnum.PAID.name().equals(paymentLog.getPaymentStatus())) return null;
        Double amount = amountOverride != null ? amountOverride : paymentLog.getPaymentAmount();
        if (amount == null || amount <= 0) return null;

        Map<String, Object> payload = new HashMap<>();
        payload.put("amount", amount);
        if (paymentLog.getCurrency() != null) {
            payload.put("currency", paymentLog.getCurrency());
        }
        if (paymentLog.getVendor() != null) {
            payload.put("vendor", paymentLog.getVendor());
        }
        payload.put("mode", MODE_OFFLINE);

        return LiveActivityEvent.builder()
                .instituteId(instituteId)
                .occurredAtEpochMillis(System.currentTimeMillis())
                .category(LiveActivityCategory.PAYMENT)
                .action(LiveActivityAction.PAYMENT_SUCCEEDED)
                .actorType(LiveActivityActorType.LEARNER)
                .dedupeKey(LiveActivityDedupeKeys.forPayment(paymentLog.getId(), PaymentStatusEnum.PAID.name()))
                .subjectId(paymentLog.getUserId())
                .entityId(paymentLog.getId())
                .payload(payload)
                .build();
    }
}
