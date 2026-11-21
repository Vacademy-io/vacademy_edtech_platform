package vacademy.io.admin_core_service.features.ai_plans_billing.gateway;

/**
 * A recurring debit could not be raised cleanly. {@link #orderId()} is set when the Razorpay order
 * was created and only the {@code /payments/create/recurring} call failed.
 *
 * <p>{@link #paymentMayExist()}: the payment call timed out, hit a 5xx, or answered something we
 * could not read. Razorpay may have accepted the recurring payment anyway, and a created payment
 * cannot be withdrawn, so the caller must NOT fall back to a payment link: it waits for the
 * webhook or the order reconcile ({@code GET /orders/{id}/payments}). A 4xx answer is a refusal:
 * no payment exists.
 */
public class RazorpayDebitException extends RazorpayGatewayException {

    private final String orderId;

    public RazorpayDebitException(RazorpayGatewayException cause, String orderId) {
        super(cause.getHttpStatus(), cause.getRazorpayCode(),
                cause.getMessage() + (orderId == null ? "" : " [order " + orderId + "]"));
        initCause(cause);
        this.orderId = orderId;
    }

    public String orderId() {
        return orderId;
    }

    public boolean paymentMayExist() {
        return orderId != null && (getHttpStatus() == 0 || getHttpStatus() >= 500);
    }
}
