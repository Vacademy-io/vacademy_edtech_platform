package vacademy.io.admin_core_service.features.platform_billing.service;

import com.fasterxml.jackson.databind.JsonNode;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;

import java.util.List;

/**
 * Extension point of {@link PlatformRazorpayWebHookService} for everything that is not a
 * credit pack: AI plan subscription charges ({@code payment_type = AI_SUBSCRIPTION}, item kind
 * AI_SUBSCRIPTION) and the autopay mandate tokens ({@code token.*} events).
 *
 * <p>The webhook service owns verification, routing, the {@code platform_payment} row lock, the
 * amount check, the PAID write, duplicate / late dispositions and the guarded auto-refund. An
 * implementation only does the subscription-side work. At most one bean may implement this; when
 * none exists an AI_SUBSCRIPTION payment makes the webhook return 500 (Razorpay retries) and token
 * events are acknowledged and logged.
 *
 * <h3>Contract for {@link #onPaymentCaptured}</h3>
 * <ul>
 *   <li>Runs inside the transaction that holds {@code SELECT ... FOR UPDATE} on the
 *       {@code platform_payment} row and BEFORE that row is marked PAID (F1). Keep it short: one
 *       call to ai_service {@code /charges/{id}/paid}.</li>
 *   <li>Must be idempotent on {@link CapturedPayment#vendorPaymentId()}: Razorpay sends both
 *       {@code payment.captured} and {@code order.paid}, and retries every non-2xx.</li>
 *   <li>Throw to make the webhook return 500 (nothing is written; Razorpay retries). Return
 *       {@link CaptureOutcome#DUPLICATE} or {@link CaptureOutcome#LATE} when the money must go
 *       back: the webhook service then records the disposition, marks the row PAID (money was
 *       received), never invoices it and requests one guarded refund.</li>
 *   <li>Return {@link CaptureOutcome#HELD} for a refusal that is neither: nothing is marked,
 *       the webhook answers 200 and staff are alerted.</li>
 *   <li>The paid amount has already been compared with the payment's server-side total
 *       ({@code platform_payment.total_amount_minor}); a mismatch never reaches the handler.</li>
 * </ul>
 */
public interface SubscriptionPaymentHandler {

    /** What happened to a captured subscription payment. */
    enum CaptureOutcome {
        /** The charge is now PAID by this payment (or already was, by this same payment id). */
        FULFILLED,
        /** The charge was already paid by a different payment: refund this one. */
        DUPLICATE,
        /** Paid after the charge was voided / the subscription ended: refund this one. */
        LATE,
        /**
         * Neither settled nor refundable on a guess (e.g. the Razorpay payment already settled a
         * different charge, or the charge has no tax snapshot): the row stays unpaid, the webhook
         * answers 200 (never a 500 loop that could get the platform webhook disabled) and staff
         * are alerted. The reconcile job may retry it.
         */
        HELD
    }

    /**
     * The captured Razorpay payment, as read from the webhook (or from a Razorpay fetch on the
     * reconcile / manual paths). Amounts in paise.
     */
    record CapturedPayment(
            String vendorPaymentId,
            long amountMinor,
            String currency,
            String method,
            String razorpayOrderId,
            String razorpayInvoiceId,
            String tokenId,
            String customerId,
            Long capturedAtEpochSeconds,
            JsonNode raw) {}

    /** One refund on a NORMAL subscription payment, after the cumulative total is recorded. */
    record RefundEvent(
            String vendorPaymentId,
            String vendorRefundId,
            long refundAmountMinor,
            long cumulativeRefundedMinor,
            boolean fullyRefunded,
            JsonNode raw) {}

    /**
     * The charge was paid. See the class comment for the contract.
     *
     * @param payment the locked row, still not PAID
     * @param items   its items (at least one AI_SUBSCRIPTION item carrying the charge id)
     */
    CaptureOutcome onPaymentCaptured(PlatformPayment payment, List<PlatformPaymentItem> items,
            CapturedPayment captured);

    /**
     * After the row is committed PAID (outside the lock): issue the invoice and send the email.
     * Must be idempotent (the invoice is unique per payment). Exceptions are logged, never
     * returned to Razorpay; the reconcile job re-runs missing invoices.
     */
    default void afterPaid(PlatformPayment payment, List<PlatformPaymentItem> items) {
    }

    /**
     * {@code payment.failed} for a subscription payment (link attempt or autopay debit). The row
     * is already marked FAILED unless it was settled. Use it to fall back to a payment link right
     * after a failed debit (D5). Exceptions are logged and acknowledged (never a 500 loop).
     */
    default void onPaymentFailed(PlatformPayment payment, List<PlatformPaymentItem> items, JsonNode paymentEntity) {
    }

    /**
     * A refund on a NORMAL subscription payment: credit note + ai_service
     * {@code /charges/{id}/refunded}. Idempotent on {@link RefundEvent#vendorRefundId()}.
     * Exceptions are logged and alerted, never a 500 loop.
     */
    default void onRefund(PlatformPayment payment, List<PlatformPaymentItem> items, RefundEvent refund) {
    }

    /**
     * True when this token id is one of the platform's autopay mandates. Lets the
     * institute-account webhook hand a mis-delivered {@code token.*} event to the platform
     * handler (token events carry no notes, only the token id).
     */
    default boolean ownsToken(String tokenId) {
        return false;
    }

    /**
     * {@code token.confirmed | token.rejected | token.paused | token.cancelled} on the platform
     * account, signature already verified. The token is at {@code payload.token.entity}; its
     * status is in {@code recurring_details.status} (see
     * https://razorpay.com/docs/api/payments/recurring-payments/webhooks/). Must be idempotent.
     * Throwing returns 500 so Razorpay retries.
     */
    default void onTokenEvent(String eventType, JsonNode tokenEntity, JsonNode root) {
    }
}
