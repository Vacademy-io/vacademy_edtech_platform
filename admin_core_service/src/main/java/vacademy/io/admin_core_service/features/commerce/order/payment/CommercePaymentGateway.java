package vacademy.io.admin_core_service.features.commerce.order.payment;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * The payment gateway as the checkout sees it. Phase 1 has one
 * implementation, Razorpay; cash on delivery (WP-31) needs none.
 *
 * <p>{@link #createOrder} talks to the gateway over the network. It is called AFTER the order
 * transaction has committed and never inside a transaction that holds stock, counter or order
 * locks; the implementation refuses to run inside one.
 */
public interface CommercePaymentGateway {

    /**
     * Creates the gateway order a shopper pays.
     *
     * @param instituteId     the seller; its own gateway account is charged
     * @param commerceOrderId {@code commerce_order.id}; the payment is tied to this order by a row
     * @param amountMinor     the order total in the minor unit of {@code currency} (paise)
     * @param currency        ISO code, {@code INR} in Phase 1
     * @param receipt         the order reference every payment log of the order carries at
     *                        {@code originalRequest.order_id}; at most 40 characters
     * @param notes           extra facts for the gateway dashboard; never trusted on the way back
     * @throws CommercePaymentGatewayException when no order could be created; nothing was charged
     *                                         and the call can be repeated for the same order
     */
    GatewayOrder createOrder(String instituteId, String commerceOrderId, long amountMinor, String currency,
                             String receipt, Map<String, String> notes);

    /** What the storefront needs to open the gateway's checkout. {@code keyId} is the public key. */
    record GatewayOrder(String vendor, String gatewayOrderId, String keyId, long amountMinor, String currency) {
    }

    /**
     * The payments the gateway knows on one of its orders, for a webhook that never arrived.
     * A remote call: never inside a transaction (the implementation refuses).
     *
     * @throws CommercePaymentGatewayException {@code NOT_CONFIGURED} when the institute has no
     *                                         gateway account, {@code UNAVAILABLE} when the
     *                                         gateway did not answer; the message names no
     *                                         credential
     */
    List<GatewayPayment> fetchPayments(String instituteId, String gatewayOrderId);

    /**
     * One payment as the gateway reports it. {@code status} is the gateway's word, lower case
     * ({@code created}, {@code authorized}, {@code captured}, {@code failed}, {@code refunded}).
     * A partly refunded payment keeps {@code captured}; {@code amountRefundedMinor} (0 when none)
     * and {@code refundStatus} (null when none) say so.
     */
    record GatewayPayment(String id, String orderId, String status, long amountMinor, String currency,
                          Instant createdAt, long amountRefundedMinor, String refundStatus) {

        /** A payment with nothing refunded. */
        public GatewayPayment(String id, String orderId, String status, long amountMinor, String currency,
                              Instant createdAt) {
            this(id, orderId, status, amountMinor, currency, createdAt, 0L, null);
        }

        /** True when any part of the payment was given back. */
        public boolean anyRefunded() {
            return amountRefundedMinor > 0 || (refundStatus != null && !refundStatus.isBlank());
        }
    }
}
