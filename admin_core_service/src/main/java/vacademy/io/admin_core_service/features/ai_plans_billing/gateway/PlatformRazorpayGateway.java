package vacademy.io.admin_core_service.features.ai_plans_billing.gateway;

import java.util.List;
import java.util.Map;

/**
 * The Razorpay calls AI-plan billing makes on the <b>platform</b> account (institute pays the
 * platform). Separate from {@code RazorpayPaymentManager}, which serves institute accounts, so
 * this flow never borrows an institute's credentials and can be mocked whole in tests.
 *
 * <p>Every method throws {@link RazorpayGatewayException} on a Razorpay error or a transport
 * failure; nothing is swallowed.
 */
public interface PlatformRazorpayGateway {

    // ── Payment Links ─ https://razorpay.com/docs/api/payments/payment-links/create-standard/ ──

    /**
     * @param expireByEpochSeconds required: Razorpay wants it at least 15 minutes ahead and at
     *                             most six months after creation (the caller clamps it)
     * @param checkoutName         {@code options.checkout.name}: the business name shown on the
     *                             hosted page (https://razorpay.com/docs/api/payments/payment-links/change-business-name/);
     *                             null keeps the account's name
     */
    record PaymentLinkRequest(
            String referenceId,
            long amountMinor,
            String currency,
            String description,
            String customerName,
            String customerEmail,
            String customerContact,
            long expireByEpochSeconds,
            String checkoutName,
            String callbackUrl,
            Map<String, String> notes) {}

    record LinkPayment(String paymentId, long amountMinor, String status) {}

    /** status: created | partially_paid | paid | expired | cancelled. */
    record PaymentLink(String id, String shortUrl, String status, Long expireBy, List<LinkPayment> payments) {

        public boolean isPaid() {
            return "paid".equalsIgnoreCase(status);
        }

        public boolean isClosed() {
            return "expired".equalsIgnoreCase(status) || "cancelled".equalsIgnoreCase(status);
        }
    }

    PaymentLink createPaymentLink(PaymentLinkRequest request);

    PaymentLink fetchPaymentLink(String linkId);

    /** {@code POST /payment_links/{id}/cancel}; only an unpaid link can be cancelled. */
    PaymentLink cancelPaymentLink(String linkId);

    // ── Recurring (UPI Autopay / card e-mandate) ──────────────────────────
    // https://razorpay.com/docs/api/payments/recurring-payments/upi/create-authorization-transaction/
    // https://razorpay.com/docs/api/payments/recurring-payments/cards/create-authorization-transaction/

    /** {@code POST /customers} with {@code fail_existing=0}: returns the existing customer for the same email+contact. */
    String createOrGetCustomer(String name, String email, String contact, Map<String, String> notes);

    record Customer(String id, String name, String email, String contact) {}

    /** {@code GET /customers/{id}}: the email and contact a recurring debit must repeat. */
    Customer fetchCustomer(String customerId);

    /**
     * A hosted registration (authorisation) link: the payer authorises the mandate on Razorpay's
     * page, so it works on white-labelled admin domains where Checkout cannot run.
     *
     * @param method       "upi" or "card"
     * @param maxAmountMinor the most one debit may take ({@code subscription_registration.max_amount})
     * @param frequency    {@code as_presented} (debits follow our renewal job, any period)
     */
    record RegistrationLinkRequest(
            String customerName,
            String customerEmail,
            String customerContact,
            long amountMinor,
            String currency,
            String description,
            String method,
            long maxAmountMinor,
            String frequency,
            Long tokenExpireAtEpochSeconds,
            long linkExpireByEpochSeconds,
            String receipt,
            Map<String, String> notes) {}

    /** The registration link is a Razorpay invoice: {@code id} = inv_..., with its own order. */
    record RegistrationLink(String id, String shortUrl, String orderId, String status) {}

    RegistrationLink createRegistrationLink(RegistrationLinkRequest request);

    /**
     * A registration link is a Razorpay invoice: {@code GET /invoices/{id}}. Mapped onto
     * {@link PaymentLink} statuses: paid -> paid, cancelled -> cancelled, expired -> expired,
     * anything else (issued, partially_paid) -> created.
     */
    PaymentLink fetchRegistrationLink(String invoiceId);

    /** {@code POST /invoices/{id}/cancel}: only an unpaid registration link can be cancelled. */
    PaymentLink cancelRegistrationLink(String invoiceId);

    /** {@code recurring_details.status}: initiated | confirmed | rejected | cancelled | paused. */
    record TokenInfo(String id, String method, String status, Long maxAmountMinor, Long expiredAt) {}

    /** {@code GET /customers/{id}/tokens} (https://razorpay.com/docs/api/payments/recurring-payments/upi/tokens/). */
    List<TokenInfo> fetchTokens(String customerId);

    /**
     * Ends a mandate. UPI: {@code PUT /customers/{cust}/tokens/{token}/cancel} starts the NPCI
     * cancellation (token.cancelled follows;
     * https://razorpay.com/docs/api/payments/recurring-payments/upi/tokens/). Cards have no cancel
     * call, only {@code DELETE /customers/{cust}/tokens/{token}}
     * (https://razorpay.com/docs/api/payments/recurring-payments/cards/tokens/).
     *
     * @param method the mandate's method (UPI | CARD | EMANDATE); anything but CARD uses cancel
     */
    void cancelToken(String customerId, String tokenId, String method);

    /**
     * A subsequent (off-session) debit on a confirmed token: {@code POST /orders} then
     * {@code POST /payments/create/recurring}
     * (https://razorpay.com/docs/api/payments/recurring-payments/upi/create-subsequent-payments/).
     * For UPI, Razorpay notifies the customer and debits about 25 h later; for cards the debit
     * runs at once. The outcome arrives on the webhook (payment.captured / payment.failed).
     */
    record RecurringDebitRequest(
            long amountMinor,
            String currency,
            String receipt,
            String customerId,
            String tokenId,
            String email,
            String contact,
            String description,
            Map<String, String> notes) {}

    record RecurringDebit(String orderId, String paymentId) {}

    RecurringDebit createRecurringDebit(RecurringDebitRequest request);

    // ── Payments and refunds ─ https://razorpay.com/docs/api/refunds/create-normal/ ──

    record PaymentInfo(String id, String status, long amountMinor, long amountRefundedMinor, String currency,
            String orderId, String tokenId, String customerId, String method, Map<String, String> notes) {}

    PaymentInfo fetchPayment(String paymentId);

    /** {@code GET /orders/{id}/payments}: the payments made against an order (registration and debit orders). */
    List<PaymentInfo> fetchOrderPayments(String orderId);

    record Refund(String id, long amountMinor, String status) {}

    /** {@code POST /payments/{id}/refund}; {@code amountMinor} null = the full payment; {@code receipt} is our reference only (not an idempotency key: callers guard with refund_requested_at). */
    Refund refund(String paymentId, Long amountMinor, String receipt, Map<String, String> notes);
}
