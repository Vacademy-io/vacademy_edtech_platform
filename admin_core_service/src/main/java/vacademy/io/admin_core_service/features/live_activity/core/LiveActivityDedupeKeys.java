package vacademy.io.admin_core_service.features.live_activity.core;

import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;

/**
 * Builders for the deterministic idempotency key behind {@code uq_ule_dedupe}.
 *
 * <p><b>The one rule: derive the key from the business fact only.</b> Never from
 * {@code System.currentTimeMillis()}, {@code UUID.randomUUID()}, or anything else that
 * differs between two attempts to record the same real-world moment. A key that stops
 * colliding does not fail loudly -- it silently disables the only defence this feature has
 * against duplicate events, and the feed starts reporting the same payment twice.
 *
 * <p>Duplicates arrive from four independent directions, all of which these keys absorb:
 * multiple replicas, provider sibling events (Razorpay emits both {@code payment.captured}
 * and {@code order.paid} for one payment), webhook retries and the deliberate
 * {@code /webhook/reprocess} replay, and {@code @Scheduled} jobs missing {@code @SchedulerLock}
 * -- {@code EwayPoolingService} and {@code CallBillingReconciliationJob} both poll on every
 * replica and feed these same producers.
 */
public final class LiveActivityDedupeKeys {

    private LiveActivityDedupeKeys() {
    }

    /**
     * Keyed on the call plus its status, because a call legitimately emits several
     * transitions. This is what makes a retried status webhook a no-op:
     * {@code CallLogService.applyEvent} re-applies an event when
     * {@code incoming.rank() >= current.rank()} for non-terminal states, so a redelivered
     * RINGING would otherwise republish.
     */
    public static String forCall(String callLogId, String status) {
        return "CALL:" + callLogId + ":" + status;
    }

    /** Keyed on the payment log plus target status -- absorbs Razorpay's sibling events. */
    public static String forPayment(String paymentLogId, String paymentStatus) {
        return "PAY:" + paymentLogId + ":" + paymentStatus;
    }

    public static String forInviteForm(String enrollInviteId, String userId, LiveActivityAction action) {
        return "INV:" + enrollInviteId + ":" + userId + ":" + action.name();
    }

    /** The audience response id is already unique per submitted lead. */
    public static String forLead(String audienceResponseId) {
        return "LEAD:" + audienceResponseId;
    }

    /**
     * Counsellor actions include a one-second bucket because a counsellor can legitimately
     * repeat an action -- two notes on the same lead, or reassigning it back. Second-level
     * granularity collapses replica duplicates while keeping genuine repeats distinct.
     */
    public static String forCounsellor(LiveActivityAction action,
                                       String entityId,
                                       String actorUserId,
                                       long occurredAtEpochMillis) {
        return "CNS:" + action.name() + ":" + entityId + ":" + actorUserId
                + ":" + (occurredAtEpochMillis / 1000L);
    }
}
