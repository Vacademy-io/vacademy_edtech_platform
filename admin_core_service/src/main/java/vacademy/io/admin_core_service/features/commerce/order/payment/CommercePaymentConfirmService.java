package vacademy.io.admin_core_service.features.commerce.order.payment;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceRefundHook;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceFactory;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceStrategy;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.common.payment.currency.CurrencyRegistry;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.RazorpayRequestDTO;
import vacademy.io.common.payment.enums.PaymentGateway;

import java.time.Duration;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Turns a payment the gateway reports into a paid commerce order. Used by the commerce
 * branch of the Razorpay webhook and by the client
 * confirmation of the storefront; both end in the same steps:
 * <ol>
 *   <li>the payment is tied to an order by the {@code commerce_gateway_order} row of the
 *       gateway order the payment was made on, never by the payment notes;</li>
 *   <li>the institute, the amount and the currency are compared with that row and with the
 *       order total; any difference is refused, nothing is written and a
 *       {@code COMMERCE_ALERT} is logged;</li>
 *   <li>one short transaction claims the logs PAID
 *       ({@code PaymentLogService.markCommerceLogsPaid}) and marks the gateway order as the one
 *       that paid the order. It registers no after-commit work, so the connection goes back to
 *       the pool before anything else happens;</li>
 *   <li>then, with no transaction open, {@code ensurePaidOrderConfirmed} runs on every
 *       delivery, replays included: it activates the plans, settles the stock and confirms the
 *       order, one short transaction at a time. A thread never holds two connections.</li>
 * </ol>
 * <b>A second captured payment</b> for an order another payment already paid (two gateway
 * orders of one order, or two payments on one) claims nothing. It is not a replay: it is
 * recorded as a payment exception, alerted and handed to the refund hook.
 *
 * <p><b>The client confirmation proves an authorisation, not a capture</b>, and carries no
 * amount, so it never marks anything PAID: it marks the gateway order AUTHORIZED (which keeps
 * the stock from being released by the shopper) and the captured webhook pays the order.
 *
 * <p>No method makes a remote call: the signature check of the client confirmation is an HMAC
 * computed locally.
 */
@Slf4j
@Service
public class CommercePaymentConfirmService {

    public static final String VENDOR_RAZORPAY = PaymentGateway.RAZORPAY.name();

    public enum Outcome {
        /** The payment is no commerce payment; the caller goes on with its own logic. */
        NOT_COMMERCE,
        /** Dealt with here; the caller must not run any legacy post-payment logic. */
        HANDLED,
        /** A commerce payment that does not match its order. Nothing was written. */
        REFUSED
    }

    /** {@code reason} is a short code for a refusal; {@code claimedLogs} is 0 on a replay. */
    public record Result(Outcome outcome, String commerceOrderId, String reason, int claimedLogs) {

        public static final Result NOT_COMMERCE = new Result(Outcome.NOT_COMMERCE, null, null, 0);

        public boolean commerce() {
            return outcome != Outcome.NOT_COMMERCE;
        }

        public boolean refused() {
            return outcome == Outcome.REFUSED;
        }
    }

    public static final String REASON_ORDER_MISMATCH = "GATEWAY_ORDER_MISMATCH";
    public static final String REASON_INSTITUTE_MISMATCH = "INSTITUTE_MISMATCH";
    public static final String REASON_ORDER_NOT_FOUND = "ORDER_NOT_FOUND";
    public static final String REASON_AMOUNT_MISMATCH = "AMOUNT_MISMATCH";
    public static final String REASON_NO_PAYMENT_LOGS = "NO_PAYMENT_LOGS";
    public static final String REASON_SIGNATURE_INVALID = "SIGNATURE_INVALID";
    /** Not a refusal: the note of a handled event that turned out to be a second payment. */
    public static final String NOTE_DUPLICATE_PAYMENT = "DUPLICATE_PAYMENT";
    /** An authorisation older than this no longer counts as a payment in progress. */
    public static final Duration AUTHORISED_WINDOW = Duration.ofMinutes(30);

    private final CommerceGatewayOrderRepository gatewayOrders;
    private final CommercePaymentGuard guard;
    private final CommerceOrderPaymentPort orders;
    private final PaymentLogService paymentLogService;
    private final InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;
    private final PaymentServiceFactory paymentServiceFactory;
    private final CommerceRefundHook refundHook;
    /** The claim transaction. Never read-only: it must read and write the primary. */
    private final TransactionTemplate claimTransaction;

    public CommercePaymentConfirmService(CommerceGatewayOrderRepository gatewayOrders, CommercePaymentGuard guard,
                                         CommerceOrderPaymentPort orders, PaymentLogService paymentLogService,
                                         InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService,
                                         PaymentServiceFactory paymentServiceFactory, CommerceRefundHook refundHook,
                                         PlatformTransactionManager transactionManager) {
        this.gatewayOrders = gatewayOrders;
        this.guard = guard;
        this.orders = orders;
        this.paymentLogService = paymentLogService;
        this.institutePaymentGatewayMappingService = institutePaymentGatewayMappingService;
        this.paymentServiceFactory = paymentServiceFactory;
        this.refundHook = refundHook;
        this.claimTransaction = new TransactionTemplate(transactionManager);
    }

    /**
     * A captured payment on {@code gatewayOrder}.
     *
     * @param instituteId     the institute whose secret verified the caller (webhook signature
     *                        or checkout signature)
     * @param paidAmountMinor what the gateway says was paid, in minor units; null when the caller
     *                        has no amount (the client confirmation), and then only the order
     *                        total is compared with the gateway order
     */
    public Result confirmPaid(CommerceGatewayOrder gatewayOrder, String instituteId, Long paidAmountMinor,
                              String paidCurrency, String gatewayPaymentId, String source) {
        Result refusal = checkOrder(gatewayOrder, instituteId, gatewayPaymentId, source);
        if (refusal != null) {
            return refusal;
        }
        CommercePaymentGuard.OrderFacts order = guard.order(gatewayOrder.getCommerceOrderId()).orElseThrow();

        long orderMinor = toMinor(order.total(), order.currency());
        boolean sameAsOrder = orderMinor == gatewayOrder.getAmountMinor()
                && sameCurrency(order.currency(), gatewayOrder.getCurrency());
        boolean sameAsPaid = paidAmountMinor == null
                || (paidAmountMinor.longValue() == gatewayOrder.getAmountMinor()
                && sameCurrency(paidCurrency, gatewayOrder.getCurrency()));
        if (!sameAsOrder || !sameAsPaid) {
            return refuse(REASON_AMOUNT_MISMATCH, gatewayOrder, instituteId, gatewayPaymentId, source,
                    "paid " + paidAmountMinor + " " + paidCurrency + ", gateway order "
                            + gatewayOrder.getAmountMinor() + " " + gatewayOrder.getCurrency()
                            + ", order total " + orderMinor + " " + order.currency());
        }

        List<String> logIds = guard.logIdsOfGroup(order.paymentGroupId());
        if (logIds.isEmpty()) {
            return refuse(REASON_NO_PAYMENT_LOGS, gatewayOrder, instituteId, gatewayPaymentId, source,
                    "the order has no payment log");
        }

        // T2: the PAID claim, and in the same transaction the mark that this gateway order is
        // the one that paid. A failure here goes up to the caller, so the gateway delivers the
        // event again. Nothing is registered to run after the commit: the connection is free
        // before the order code starts.
        String rowId = gatewayOrder.getId();
        List<String> claimed = claimTransaction.execute(status -> {
            List<String> won = paymentLogService.markCommerceLogsPaid(logIds);
            if (!won.isEmpty()) {
                gatewayOrders.markPaying(rowId, gatewayPaymentId, new Date());
            }
            return won;
        });
        if (claimed == null) {
            claimed = List.of();
        }
        String note = null;
        if (!claimed.isEmpty()) {
            log.info("Commerce payment for order {} ({}): {} log(s) claimed PAID", order.id(), source,
                    claimed.size());
        } else if (isSecondPayment(gatewayOrder, gatewayPaymentId)) {
            // Money was taken a second time for an order that is already paid.
            gatewayOrders.moveUnlessPaid(rowId, CommerceGatewayOrder.STATUS_PAID, gatewayPaymentId, new Date());
            note = NOTE_DUPLICATE_PAYMENT;
            long minor = paidAmountMinor != null ? paidAmountMinor : gatewayOrder.getAmountMinor();
            refundHook.refundDuplicatePayment(order.instituteId(), order.id(), guard.orderNumber(order.id()),
                    gatewayOrder.getGatewayOrderId(), gatewayPaymentId, fromMinor(minor, order.currency()),
                    order.currency());
        } else {
            gatewayOrders.moveUnlessPaid(rowId, CommerceGatewayOrder.STATUS_PAID, gatewayPaymentId, new Date());
            if (gatewayPaymentId != null) {
                gatewayOrders.rememberPaymentId(rowId, gatewayPaymentId, new Date());
            }
            log.info("Commerce payment replay for order {} ({}): no log claimed", order.id(), source);
        }
        ensureConfirmed(order.id());
        return new Result(Outcome.HANDLED, order.id(), note, claimed.size());
    }

    /**
     * True when the logs of the order were claimed by another payment than this one. The row
     * marked {@code paying} names the payment that paid; an event without a payment id, or an
     * order no gateway row paid (none marked), is treated as a replay.
     */
    private boolean isSecondPayment(CommerceGatewayOrder gatewayOrder, String gatewayPaymentId) {
        if (!StringUtils.hasText(gatewayPaymentId)) {
            return false;
        }
        Optional<CommerceGatewayOrder> paying = gatewayOrders
                .findFirstByCommerceOrderIdAndPayingTrue(gatewayOrder.getCommerceOrderId());
        if (paying.isEmpty()) {
            return false;
        }
        String paidBy = paying.get().getGatewayPaymentId();
        if (paying.get().getId().equals(gatewayOrder.getId())) {
            // The same gateway order: a second payment only when both ids are known and differ.
            return StringUtils.hasText(paidBy) && !paidBy.equals(gatewayPaymentId);
        }
        // Another gateway order of the same commerce order was paid: this payment is extra.
        return true;
    }

    /** True while a payment on this order was authorised lately and is not captured or failed. */
    public boolean paymentInProgress(String commerceOrderId) {
        if (!StringUtils.hasText(commerceOrderId)) {
            return false;
        }
        Date since = new Date(System.currentTimeMillis() - AUTHORISED_WINDOW.toMillis());
        return gatewayOrders.countAuthorizedSince(commerceOrderId, since) > 0;
    }

    /**
     * A failed payment attempt: logs FAILED (unless PAID), plans PAYMENT_FAILED. The order is
     * not cancelled and no hold is released; a later capture on the same gateway order pays it.
     */
    public Result markFailed(CommerceGatewayOrder gatewayOrder, String instituteId, String gatewayPaymentId,
                             String source) {
        Result refusal = checkOrder(gatewayOrder, instituteId, gatewayPaymentId, source);
        if (refusal != null) {
            return refusal;
        }
        CommercePaymentGuard.OrderFacts order = guard.order(gatewayOrder.getCommerceOrderId()).orElseThrow();
        List<String> changed = paymentLogService.markCommerceLogsFailed(guard.logIdsOfGroup(order.paymentGroupId()));
        gatewayOrders.moveUnlessPaid(gatewayOrder.getId(), CommerceGatewayOrder.STATUS_FAILED, gatewayPaymentId,
                new Date());
        log.info("Commerce payment failed for order {} ({}): {} log(s) marked FAILED", order.id(), source,
                changed.size());
        return new Result(Outcome.HANDLED, order.id(), null, 0);
    }

    /**
     * A payment was authorised and waits for capture. Only the gateway row changes; while it is
     * AUTHORIZED the public hold release keeps the stock of the order.
     */
    public Result markAuthorized(CommerceGatewayOrder gatewayOrder, String instituteId, String gatewayPaymentId,
                                 String source) {
        Result refusal = checkOrder(gatewayOrder, instituteId, gatewayPaymentId, source);
        if (refusal != null) {
            return refusal;
        }
        gatewayOrders.moveUnlessPaid(gatewayOrder.getId(), CommerceGatewayOrder.STATUS_AUTHORIZED, gatewayPaymentId,
                new Date());
        return new Result(Outcome.HANDLED, gatewayOrder.getCommerceOrderId(), null, 0);
    }

    /**
     * The storefront's confirmation after the gateway checkout closed with success: the
     * browser sends the gateway order id, the payment id and the checkout signature. The
     * signature (HMAC of "order|payment" with the institute's key secret, computed here, no
     * remote call) proves that this payment paid this gateway order; the gateway order is then
     * tied to the commerce order by its row, as on the webhook.
     *
     * <p>The signature proves that the payment was <b>authorised</b>. It does not prove a
     * capture (an account on manual capture, or a capture that lapses, gives the money back)
     * and it carries no amount. So nothing is marked PAID here: the gateway order becomes
     * AUTHORIZED, which keeps the shopper's release call from freeing the stock, and the
     * captured webhook pays the order. An order the webhook has already paid is confirmed now
     * if its confirm step had failed.
     */
    public Result confirmClientPayment(String instituteId, String gatewayOrderId, String gatewayPaymentId,
                                       String signature) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(gatewayOrderId)
                || !StringUtils.hasText(gatewayPaymentId) || !StringUtils.hasText(signature)) {
            return new Result(Outcome.REFUSED, null, REASON_SIGNATURE_INVALID, 0);
        }
        Optional<CommerceGatewayOrder> found = gatewayOrders.findByVendorAndGatewayOrderId(VENDOR_RAZORPAY,
                gatewayOrderId.trim());
        if (found.isEmpty() || !instituteId.equals(found.get().getInstituteId())) {
            // The same answer for an unknown order and for another institute's order.
            log.warn("Commerce client confirmation for an unknown gateway order of institute {}", instituteId);
            return new Result(Outcome.REFUSED, null, REASON_ORDER_MISMATCH, 0);
        }
        try {
            Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                    .findInstitutePaymentGatewaySpecifData(VENDOR_RAZORPAY, instituteId);
            PaymentServiceStrategy strategy = paymentServiceFactory.getStrategy(PaymentGateway.RAZORPAY);
            RazorpayRequestDTO proof = new RazorpayRequestDTO();
            proof.setRazorpayOrderId(gatewayOrderId.trim());
            proof.setRazorpayPaymentId(gatewayPaymentId.trim());
            proof.setRazorpaySignature(signature.trim());
            PaymentInitiationRequestDTO request = new PaymentInitiationRequestDTO();
            request.setRazorpayRequest(proof);
            strategy.verifyClientPaymentConfirmation(request, gatewayData);
        } catch (RuntimeException e) {
            // The message of the strategy names no secret, but it is not passed on either.
            log.warn("Commerce client confirmation refused for order {}: signature check failed",
                    found.get().getCommerceOrderId());
            return new Result(Outcome.REFUSED, found.get().getCommerceOrderId(), REASON_SIGNATURE_INVALID, 0);
        }
        CommerceGatewayOrder gatewayOrder = found.get();
        Result refusal = checkOrder(gatewayOrder, instituteId, gatewayPaymentId.trim(), "client");
        if (refusal != null) {
            return refusal;
        }
        gatewayOrders.moveUnlessPaid(gatewayOrder.getId(), CommerceGatewayOrder.STATUS_AUTHORIZED,
                gatewayPaymentId.trim(), new Date());
        ensureConfirmed(gatewayOrder.getCommerceOrderId());
        return new Result(Outcome.HANDLED, gatewayOrder.getCommerceOrderId(), null, 0);
    }

    /**
     * Runs {@code ensurePaidOrderConfirmed} and, when the order is no longer waiting for
     * payment afterwards, marks its gateway rows settled so the reconcile job leaves it alone.
     * Never throws: a paid order that stays unconfirmed is found by the next delivery and by
     * the job.
     *
     * @return true when the order is no longer PENDING_PAYMENT
     */
    public boolean ensureConfirmed(String commerceOrderId) {
        try {
            orders.ensurePaidOrderConfirmed(commerceOrderId);
        } catch (Exception e) {
            log.error("COMMERCE_ALERT paid order {} could not be confirmed: {}", commerceOrderId, e.getMessage(), e);
            SentryLogger.logError(e, "Commerce paid order not confirmed",
                    Map.of("commerce.order.id", String.valueOf(commerceOrderId)));
            return false;
        }
        try {
            Optional<CommercePaymentGuard.OrderFacts> after = guard.order(commerceOrderId);
            if (after.isPresent() && !"PENDING_PAYMENT".equals(after.get().status())) {
                gatewayOrders.settle(commerceOrderId, new Date());
                return true;
            }
        } catch (Exception e) {
            log.warn("Could not mark the gateway rows of order {} settled: {}", commerceOrderId, e.getMessage());
        }
        return false;
    }

    private Result checkOrder(CommerceGatewayOrder gatewayOrder, String instituteId, String gatewayPaymentId,
                              String source) {
        if (!StringUtils.hasText(instituteId) || !instituteId.equals(gatewayOrder.getInstituteId())) {
            return refuse(REASON_INSTITUTE_MISMATCH, gatewayOrder, instituteId, gatewayPaymentId, source,
                    "the gateway order belongs to another institute");
        }
        Optional<CommercePaymentGuard.OrderFacts> order = guard.order(gatewayOrder.getCommerceOrderId());
        if (order.isEmpty()) {
            return refuse(REASON_ORDER_NOT_FOUND, gatewayOrder, instituteId, gatewayPaymentId, source,
                    "the commerce order of the gateway order does not exist");
        }
        if (!instituteId.equals(order.get().instituteId())) {
            return refuse(REASON_INSTITUTE_MISMATCH, gatewayOrder, instituteId, gatewayPaymentId, source,
                    "the commerce order belongs to another institute");
        }
        return null;
    }

    /** The alert of a refused commerce payment. Money may have been taken: someone must look. */
    Result refuse(String reason, CommerceGatewayOrder gatewayOrder, String instituteId, String gatewayPaymentId,
                  String source, String detail) {
        String commerceOrderId = gatewayOrder == null ? null : gatewayOrder.getCommerceOrderId();
        String gatewayOrderId = gatewayOrder == null ? null : gatewayOrder.getGatewayOrderId();
        log.error("COMMERCE_ALERT commerce payment refused ({}): {} [source={}, institute={}, order={}, "
                        + "gatewayOrder={}, payment={}]", reason, detail, source, instituteId, commerceOrderId,
                gatewayOrderId, gatewayPaymentId);
        Map<String, String> tags = new LinkedHashMap<>();
        tags.put("reason", reason);
        tags.put("source", String.valueOf(source));
        tags.put("institute.id", String.valueOf(instituteId));
        tags.put("commerce.order.id", String.valueOf(commerceOrderId));
        tags.put("gateway.order.id", String.valueOf(gatewayOrderId));
        tags.put("gateway.payment.id", String.valueOf(gatewayPaymentId));
        SentryLogger.logError(new SecurityException("Commerce payment refused: " + reason),
                "Commerce payment refused", tags);
        return new Result(Outcome.REFUSED, commerceOrderId, reason, 0);
    }

    /** The order total in minor units, exact; -1 when it cannot be expressed. */
    static long toMinor(java.math.BigDecimal amount, String currency) {
        if (amount == null || !StringUtils.hasText(currency)) {
            return -1;
        }
        try {
            return amount.movePointRight(CurrencyRegistry.minorUnitExponent(currency)).longValueExact();
        } catch (ArithmeticException e) {
            return -1;
        }
    }

    static java.math.BigDecimal fromMinor(long minor, String currency) {
        try {
            return java.math.BigDecimal.valueOf(minor, CurrencyRegistry.minorUnitExponent(currency));
        } catch (RuntimeException e) {
            return java.math.BigDecimal.valueOf(minor, 2);
        }
    }

    private static boolean sameCurrency(String a, String b) {
        return a != null && b != null && a.trim().equalsIgnoreCase(b.trim());
    }
}
