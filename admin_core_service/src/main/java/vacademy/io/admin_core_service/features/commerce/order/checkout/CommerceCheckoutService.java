package vacademy.io.admin_core_service.features.commerce.order.checkout;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService;
import vacademy.io.admin_core_service.features.commerce.order.pincode.PincodeStates;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CartPricingException;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceBotCheck;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceRateLimiter;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.tax.service.GstinValidator;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Places an online prepaid order.
 *
 * <p>The order of the steps is the design: everything remote or slow happens with no database
 * transaction open.
 * <ol>
 *   <li>validate the body (caps on every text and on the line count);</li>
 *   <li>idempotency: the same {@code client_request_id} with the same body answers the order
 *       it created; with another body it is refused (409);</li>
 *   <li>price again through {@code priceCart}; a total other than the one the shopper saw, or
 *       a line that can no longer be bought, is answered 409 with the new price;</li>
 *   <li>the limits per network address (database, all pods) and the bot check (remote; with
 *       no bot check set up at all checkout answers 503), then the open unpaid orders per
 *       phone and per e-mail;</li>
 *   <li>resolve the buyer (remote) and take the order number (its own short transaction). A
 *       phone typed at checkout is not proof of who the shopper is: without a verified-phone
 *       token the buyer is the account of the e-mail, and the customer row of that phone is
 *       neither read for an identity nor changed;</li>
 *   <li><b>one transaction</b>: order, lines, holds, plans, logs, tender, history
 *       ({@link CommerceOrderWriter});</li>
 *   <li>after the commit: the gateway order (remote), then one short transaction that stores
 *       it. A failed gateway call leaves the order PENDING_PAYMENT for a retry; the claim on
 *       the order row means the gateway is never asked twice at once for one order.</li>
 * </ol>
 * COD is a later package: the payment method is checked in one place ({@link #paymentMethod}).
 */
@Slf4j
@Service
public class CommerceCheckoutService {

    /** Unpaid orders one phone or one e-mail may have open at a time. */
    public static final int MAX_OPEN_UNPAID_ORDERS = 3;
    /** The same, for a shopper whose phone was proved by an OTP. */
    public static final int MAX_OPEN_UNPAID_ORDERS_VERIFIED = 10;
    /** A gateway call that has not answered after this long no longer blocks a retry. */
    static final long GATEWAY_CLAIM_MILLIS = 120_000L;

    /**
     * Limits per network address, counted in the database for all pods.
     * The address is the one the request came from, never a header the caller chooses. A
     * server-side caller places orders for many shoppers from one address and gets the larger
     * allowance; the bot check is what stops a script, these only bound what one address can
     * hold.
     */
    static final int ATTEMPTS_PER_ADDRESS_10_MIN = 60;
    static final int ATTEMPTS_PER_SERVER_10_MIN = 300;
    static final int ORDERS_PER_ADDRESS_15_MIN = 20;
    static final int ORDERS_PER_SERVER_15_MIN = 100;
    static final Duration ATTEMPT_WINDOW = Duration.ofMinutes(10);
    static final Duration ORDER_WINDOW = Duration.ofMinutes(15);
    static final String SCOPE_ATTEMPT = "checkout-attempt-ip";
    static final String SCOPE_ORDER = "checkout-order-ip";

    private static final Pattern REQUEST_ID = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]{1,64}@[^@\\s]{1,255}\\.[^@\\s.]{2,}$");
    private static final Pattern PINCODE = Pattern.compile("^[1-9][0-9]{5}$");

    private final CommerceOrderService orderService;
    private final CommerceOrderWriter writer;
    private final CommerceBuyerResolver buyerResolver;
    private final CommerceCounterService counterService;
    private final CommerceStockSettings stockSettings;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceOrderLegacyRepository legacyRepository;
    private final CheckoutGateway gateway;
    private final CommerceOrderAccessTokens accessTokens;
    private final CommerceBotCheck botCheck;
    private final CommercePaymentConfirmService paymentConfirmService;
    private final CommerceOrderPaymentService orderPaymentService;
    private final CommerceRateLimiter rateLimiter;
    private final VerifiedPhones verifiedPhones;
    private final ObjectMapper objectMapper;
    /** Not read-only: a read-only transaction would read the replica. */
    private final TransactionTemplate primary;

    public CommerceCheckoutService(CommerceOrderService orderService,
                                   CommerceOrderWriter writer,
                                   CommerceBuyerResolver buyerResolver,
                                   CommerceCounterService counterService,
                                   CommerceStockSettings stockSettings,
                                   CommerceOrderRepository orderRepository,
                                   CommerceOrderLineRepository lineRepository,
                                   CommerceOrderLegacyRepository legacyRepository,
                                   CheckoutGateway gateway,
                                   CommerceOrderAccessTokens accessTokens,
                                   CommerceBotCheck botCheck,
                                   CommercePaymentConfirmService paymentConfirmService,
                                   CommerceOrderPaymentService orderPaymentService,
                                   CommerceRateLimiter rateLimiter,
                                   VerifiedPhones verifiedPhones,
                                   ObjectMapper objectMapper,
                                   PlatformTransactionManager transactionManager) {
        this.orderService = orderService;
        this.writer = writer;
        this.buyerResolver = buyerResolver;
        this.counterService = counterService;
        this.stockSettings = stockSettings;
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.legacyRepository = legacyRepository;
        this.gateway = gateway;
        this.accessTokens = accessTokens;
        this.botCheck = botCheck;
        this.paymentConfirmService = paymentConfirmService;
        this.orderPaymentService = orderPaymentService;
        this.rateLimiter = rateLimiter;
        this.verifiedPhones = verifiedPhones;
        this.objectMapper = objectMapper;
        this.primary = new TransactionTemplate(transactionManager);
    }

    /** The request after validation: trimmed, capped and in the stored spellings. */
    record Clean(String clientRequestId, List<CartPriceRequest.Line> lines, String couponCode, String locale,
                 BigDecimal expectedTotal, String name, String phone, String email,
                 Map<String, Object> shippingAddress, Map<String, Object> billingAddress,
                 CommerceCustomerService.AddressInput addressToRemember, boolean marketingConsent,
                 String buyerGstin, String customerNote, String giftNote, String challengeToken,
                 String phoneToken) {
    }

    // ------------------------------------------------------------------ place

    /** As {@link #placeOrder(String, CheckoutRequest, String, boolean)} for a browser call. */
    public CheckoutDtos.Placed placeOrder(String instituteId, CheckoutRequest request, String clientIp) {
        return placeOrder(instituteId, request, clientIp, false);
    }

    /**
     * @param clientIp   the network address the request came from, for the limits and the bot
     *                   check; may be null
     * @param serverSide true when the call came from a server (no Origin header), which places
     *                   orders for many shoppers from one address
     */
    public CheckoutDtos.Placed placeOrder(String instituteId, CheckoutRequest request, String clientIp,
                                          boolean serverSide) {
        if (!accessTokens.isConfigured()) {
            throw new CheckoutException(HttpStatus.SERVICE_UNAVAILABLE, CheckoutException.NOT_CONFIGURED,
                    "Checkout is not available for this shop yet.");
        }
        Clean clean = validate(request);
        String hash = requestHash(clean);

        // Idempotency, first look: the common replay (double click, retry after a timeout).
        CommerceOrder earlier = primary.execute(status -> orderRepository
                .findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId()).orElse(null));
        if (earlier != null) {
            return replay(earlier, hash);
        }

        // No bot check set up at all is not "off": without it one script can hold the stock of
        // the whole shop in unpaid orders. The deployment or the institute must say so.
        if (botCheck.notConfigured(instituteId)) {
            log.error("COMMERCE_ALERT checkout_refused_no_bot_check institute={} (set COMMERCE_TURNSTILE_SECRET, "
                    + "or COMMERCE_TURNSTILE_REQUIRED=false, or botCheck.enabled=false for the institute)",
                    instituteId);
            throw new CheckoutException(HttpStatus.SERVICE_UNAVAILABLE, CheckoutException.NOT_CONFIGURED,
                    "Checkout is not available for this shop yet.");
        }
        requireUnderAddressLimit(instituteId, SCOPE_ATTEMPT, clientIp, ATTEMPT_WINDOW,
                serverSide ? ATTEMPTS_PER_SERVER_10_MIN : ATTEMPTS_PER_ADDRESS_10_MIN);

        // After the replay, which creates nothing: a bot-check token can be spent only once, so
        // the retry of a request that already made its order must not be asked for it again.
        // A remote call; no transaction is open.
        if (!botCheck.verify(instituteId, clean.challengeToken(), clientIp)) {
            throw new CheckoutException(HttpStatus.FORBIDDEN, CheckoutException.BOT_CHECK_FAILED,
                    "The security check did not pass. Reload the page and try again.");
        }

        CartPriceSnapshot snapshot = price(instituteId, clean);
        // The phone is proved only by the token of an OTP sent to it, for this shop and for
        // checkout. Everything that touches the customer of that phone depends on this.
        boolean phoneVerified = clean.phoneToken() != null && clean.phone().equals(
                verifiedPhones.phoneOf(instituteId, clean.phoneToken(), VerifiedPhones.PURPOSE_CHECKOUT));
        requireUnderOpenOrderCap(instituteId, clean, phoneVerified);
        // The state the tax was computed for is the state of the address the order keeps: the
        // pincode decides, and a state typed beside it is only used when the pincode names none.
        String state = snapshot.getPlaceOfSupplyState();
        clean.shippingAddress().put("state_code", state);
        CommerceCustomerService.AddressInput typed = clean.addressToRemember();
        CommerceCustomerService.AddressInput remember = typed == null ? null
                : new CommerceCustomerService.AddressInput(typed.label(), typed.name(), typed.phone(), typed.line1(),
                        typed.line2(), typed.landmark(), typed.city(), state, typed.pincode(), typed.makeDefault());

        // Remote, then the counter in its own short transaction: nothing is locked meanwhile.
        String userId = buyerResolver.resolveUserId(instituteId, clean.phone(), clean.name(), clean.email(),
                phoneVerified);
        // Counted last, just before the order is written: what one address may hold in unpaid
        // orders during one hold time.
        requireUnderAddressLimit(instituteId, SCOPE_ORDER, clientIp, ORDER_WINDOW,
                serverSide ? ORDERS_PER_SERVER_15_MIN : ORDERS_PER_ADDRESS_15_MIN);
        String orderNumber = counterService.nextNumber(instituteId, CommerceOrderWriter.ORDER_COUNTER_SCOPE);
        int holdMinutes = stockSettings.holdMinutes(instituteId);

        CommerceOrderWriter.NewOrder newOrder = new CommerceOrderWriter.NewOrder(instituteId, orderNumber,
                clean.clientRequestId(), hash, userId, clean.phone(), clean.name(), clean.email(),
                clean.shippingAddress(), clean.billingAddress(), remember,
                clean.marketingConsent(), clean.buyerGstin(), clean.customerNote(), clean.giftNote(), snapshot,
                holdMinutes, phoneVerified);
        CommerceOrderWriter.Written written;
        try {
            written = primary.execute(status -> writer.write(newOrder));
        } catch (DataIntegrityViolationException e) {
            // Two requests with one key at the same moment: the other one won the unique key.
            CommerceOrder winner = primary.execute(status -> orderRepository
                    .findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId()).orElse(null));
            if (winner == null) {
                throw e;
            }
            return replay(winner, hash);
        } catch (CheckoutException e) {
            // The other request with this key may have won in a way that shows here as a
            // refusal (it took the last piece, or the last use of the coupon). The order it
            // made is this shopper's order: answer that, not the refusal.
            CommerceOrder winner = primary.execute(status -> orderRepository
                    .findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId()).orElse(null));
            if (winner == null) {
                throw e;
            }
            return replay(winner, hash);
        }
        CommerceOrder order = written.order();
        log.info("Commerce order {} ({}) placed for institute {}: {} line(s), total {} {}", order.getOrderNumber(),
                order.getId(), instituteId, written.lines().size(), order.getTotal(), order.getCurrency());

        CheckoutDtos.Payment payment = gatewayOrder(order.getId());
        CheckoutDtos.Hold hold = CheckoutDtos.Hold.builder()
                .paymentLogId(order.getPrimaryPaymentLogId())
                .releaseToken(written.releaseToken())
                .expiresAt(order.getHoldExpiresAt().toInstant().toString())
                .build();
        return placed(order, payment, hold, false, false);
    }

    private CheckoutDtos.Placed replay(CommerceOrder earlier, String hash) {
        if (!hash.equals(earlier.getRequestHash())) {
            throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.IDEMPOTENCY_KEY_REUSED,
                    "This client_request_id was used for a different order.");
        }
        return paymentStep(earlier);
    }

    /**
     * The payment step of an order that exists: none while a payment on it is in progress
     * (the answer says so, and nothing is offered that could be paid a second time), else the
     * gateway order when the order can still be paid. The order is read again afterwards: the
     * payable check may have cancelled it.
     */
    private CheckoutDtos.Placed paymentStep(CommerceOrder order) {
        if (CommerceOrderStatus.of(order.getStatus()) == CommerceOrderStatus.PENDING_PAYMENT
                && paymentConfirmService.paymentInProgress(order.getId())) {
            return placed(order, null, null, true, true);
        }
        CheckoutDtos.Payment payment = gatewayOrder(order.getId());
        return placed(reread(order), payment, null, true, false);
    }

    private CommerceOrder reread(CommerceOrder order) {
        CommerceOrder now = primary.execute(status -> orderRepository.findById(order.getId()).orElse(null));
        return now == null ? order : now;
    }

    /**
     * Asks for the payment step of an unpaid order again (the gateway call failed earlier, or
     * the page was reloaded). Only the holder of the order's access token may ask: an order id
     * alone opens nothing.
     */
    public CheckoutDtos.Placed retryPayment(String instituteId, String orderId, String orderAccessToken) {
        CommerceOrderAccessTokens.Access access = accessTokens.verify(orderAccessToken);
        if (access == null || !access.instituteId().equals(instituteId) || !access.orderId().equals(orderId)) {
            throw new CheckoutException(HttpStatus.FORBIDDEN, CheckoutException.TOKEN_INVALID,
                    "The order link is not valid or has expired.");
        }
        CommerceOrder order = primary.execute(status -> orderRepository
                .findByIdAndInstituteId(orderId, instituteId).orElse(null));
        if (order == null) {
            throw new CheckoutException(HttpStatus.NOT_FOUND, CheckoutException.ORDER_NOT_FOUND, "Order not found.");
        }
        if (CommerceOrderStatus.of(order.getStatus()) != CommerceOrderStatus.PENDING_PAYMENT) {
            throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.ORDER_NOT_PAYABLE,
                    "This order is not waiting for a payment.");
        }
        CheckoutDtos.Placed answer = paymentStep(order);
        if (!CommerceOrderStatus.PENDING_PAYMENT.name().equals(answer.getStatus())) {
            // Its stock was no longer held (the time ran out, or the shopper gave it back):
            // the order was closed instead of being offered for payment.
            throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.ORDER_NOT_PAYABLE,
                    "This order can no longer be paid. Please place it again.");
        }
        return answer;
    }

    /**
     * The storefront's word that the gateway checkout closed with success: gateway order id,
     * payment id and the checkout signature. The payment code checks the signature and ties
     * the payment to the order by its own gateway-order row; this method only refuses a proof
     * that belongs to another order and answers the order as it is afterwards.
     *
     * <p>The proof shows an authorisation, not a capture, so this call never marks the order
     * paid: the captured webhook does. Until it arrives the answer is PENDING_PAYMENT with
     * {@code payment_processing = true} and no payment step; the storefront shows "payment
     * received, confirming" and reads the order again.
     */
    public CheckoutDtos.Placed confirmClientPayment(String instituteId, String orderId, String gatewayOrderId,
                                                    String gatewayPaymentId, String signature) {
        CommercePaymentConfirmService.Result result = paymentConfirmService.confirmClientPayment(instituteId,
                gatewayOrderId, gatewayPaymentId, signature);
        if (result == null || result.refused() || !result.commerce() || orderId == null
                || !orderId.equals(result.commerceOrderId())) {
            throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.PAYMENT_NOT_CONFIRMED,
                    "The payment could not be confirmed. If money was taken, the order updates in a few minutes.");
        }
        CommerceOrder order = primary.execute(status -> orderRepository
                .findByIdAndInstituteId(orderId, instituteId).orElse(null));
        if (order == null) {
            throw new CheckoutException(HttpStatus.NOT_FOUND, CheckoutException.ORDER_NOT_FOUND, "Order not found.");
        }
        return placed(order, null, null, true, true);
    }

    private CheckoutDtos.Placed placed(CommerceOrder order, CheckoutDtos.Payment payment, CheckoutDtos.Hold hold,
                                       boolean replayed, boolean processing) {
        boolean pending = CommerceOrderStatus.of(order.getStatus()) == CommerceOrderStatus.PENDING_PAYMENT;
        return CheckoutDtos.Placed.builder()
                .orderId(order.getId())
                .orderNumber(order.getOrderNumber())
                .status(order.getStatus())
                .paymentStatus(order.getPaymentStatus())
                .currency(order.getCurrency())
                .total(order.getTotal())
                .payment(pending && !processing ? payment : null)
                .paymentRetryable(pending && payment == null && !processing)
                .paymentProcessing(pending && processing)
                .hold(hold)
                .orderAccessToken(accessTokens.issue(order.getInstituteId(), order.getId()))
                .orderAccessTokenExpiresAt(accessTokens.expiryOfNewToken().toString())
                .replayed(replayed)
                .build();
    }

    // ------------------------------------------------------------------ gateway

    /**
     * The gateway order of an unpaid order: the stored one, or a new one. Called with no
     * transaction open. Returns null when the order is not waiting for a payment, when its
     * stock is no longer held (the order is then cancelled by the payable check), when another
     * caller is talking to the gateway right now, or when the gateway call failed; in the last
     * two cases the order stays PENDING_PAYMENT and the storefront asks again.
     */
    CheckoutDtos.Payment gatewayOrder(String orderId) {
        // A payment step is handed out only for stock that is still held for this order.
        if (!orderPaymentService.ensurePayable(orderId)) {
            return null;
        }
        CommerceOrder order = primary.execute(status -> orderRepository.findById(orderId).orElse(null));
        if (order == null || CommerceOrderStatus.of(order.getStatus()) != CommerceOrderStatus.PENDING_PAYMENT) {
            return null;
        }
        if (StringUtils.hasText(order.getGatewayOrderId())) {
            return payment(order);
        }
        Date now = new Date();
        Integer claimed = primary.execute(status -> orderRepository.claimGatewayAttempt(orderId, now,
                new Date(now.getTime() - GATEWAY_CLAIM_MILLIS)));
        if (claimed == null || claimed != 1) {
            // Someone else is creating it, or has just stored it.
            CommerceOrder again = primary.execute(status -> orderRepository.findById(orderId).orElse(null));
            return again != null && StringUtils.hasText(again.getGatewayOrderId())
                    && CommerceOrderStatus.of(again.getStatus()) == CommerceOrderStatus.PENDING_PAYMENT
                    ? payment(again) : null;
        }

        long amountMinor = CommerceOrderPaymentService.minor(order.getTotal());
        Map<String, String> notes = new LinkedHashMap<>();
        // The webhook finds the payment logs by this reference; it is the order id, never a log id.
        notes.put("orderId", order.getId());
        notes.put("instituteId", order.getInstituteId());
        notes.put("commerce_order_id", order.getId());
        notes.put("order_number", order.getOrderNumber());
        CheckoutGateway.GatewayOrderRef created;
        try {
            created = gateway.createOrder(order.getInstituteId(), order.getId(), amountMinor, order.getCurrency(),
                    order.getId(), notes);
        } catch (RuntimeException e) {
            // The message of a gateway failure can carry request details: only its type is logged.
            log.error("Gateway order for commerce order {} ({}) failed: {}", order.getOrderNumber(), order.getId(),
                    e.getClass().getSimpleName());
            primary.execute(status -> orderRepository.releaseGatewayAttempt(orderId));
            return null;
        }
        if (created == null || !StringUtils.hasText(created.gatewayOrderId())
                || created.amountMinor() != amountMinor
                || (created.currency() != null && !created.currency().equalsIgnoreCase(order.getCurrency()))) {
            log.error("COMMERCE_ALERT gateway_order_unusable institute={} order={} number={}",
                    order.getInstituteId(), order.getId(), order.getOrderNumber());
            primary.execute(status -> orderRepository.releaseGatewayAttempt(orderId));
            return null;
        }

        String logJson = gatewayLogJson(order, created);
        Integer stored;
        try {
            stored = storeGatewayOrder(order, created, logJson);
        } catch (RuntimeException e) {
            // The gateway order exists and has its row; only the copy on the order failed. The
            // claim goes back so the shopper can ask again at once (the gateway then answers
            // the same order), instead of waiting for the claim to lapse.
            log.error("Gateway order of commerce order {} ({}) could not be stored: {}", order.getOrderNumber(),
                    order.getId(), e.getClass().getSimpleName());
            primary.execute(status -> orderRepository.releaseGatewayAttempt(orderId));
            return null;
        }
        CommerceOrder after = primary.execute(status -> orderRepository.findById(orderId).orElse(null));
        if (stored == null || stored != 1) {
            // Only after a claim went stale during a very slow gateway call: the order now has
            // two gateway orders, and both can be paid. A payment on the one that is not stored
            // is a real payment on a real gateway order of this order. If it is the only one it
            // pays the order; if the other one is paid too it is a second payment, which
            // CommercePaymentConfirmService records as DUPLICATE_PAYMENT for a refund.
            log.error("COMMERCE_ALERT gateway_order_orphaned institute={} order={} number={}",
                    order.getInstituteId(), order.getId(), order.getOrderNumber());
        }
        return after != null && StringUtils.hasText(after.getGatewayOrderId())
                && CommerceOrderStatus.of(after.getStatus()) == CommerceOrderStatus.PENDING_PAYMENT
                ? payment(after) : null;
    }

    private Integer storeGatewayOrder(CommerceOrder order, CheckoutGateway.GatewayOrderRef created, String logJson) {
        String orderId = order.getId();
        return primary.execute(status -> {
            int rows = orderRepository.storeGatewayOrder(orderId, created.vendor(), created.gatewayOrderId(),
                    created.keyId());
            if (rows == 1) {
                List<String> logIds = new ArrayList<>();
                for (CommerceOrderLine line : lineRepository.findByOrderIdOrderByLineNoAsc(orderId)) {
                    if (StringUtils.hasText(line.getPaymentLogId())) {
                        logIds.add(line.getPaymentLogId());
                    }
                }
                if (!logIds.isEmpty()) {
                    legacyRepository.storeGatewayDataOnLogs(logIds, order.getPaymentGroupId(), logJson);
                }
            }
            return rows;
        });
    }

    private static CheckoutDtos.Payment payment(CommerceOrder order) {
        return CheckoutDtos.Payment.builder()
                .vendor(order.getGatewayVendor())
                .gatewayOrderId(order.getGatewayOrderId())
                .keyId(order.getGatewayKeyId())
                .amountMinor(CommerceOrderPaymentService.minor(order.getTotal()))
                .currency(order.getCurrency())
                .build();
    }

    /**
     * {@code payment_specific_data} of every log of the order after the gateway order exists.
     * The column is replaced whole, so the JSON keeps {@code originalRequest.order_id} (how
     * the webhook finds the logs) beside {@code response} (what the gateway answered).
     */
    private String gatewayLogJson(CommerceOrder order, CheckoutGateway.GatewayOrderRef created) {
        Map<String, Object> originalRequest = new LinkedHashMap<>();
        originalRequest.put("order_id", order.getId());
        originalRequest.put("institute_id", order.getInstituteId());
        originalRequest.put("commerce_order_number", order.getOrderNumber());
        Map<String, Object> responseData = new LinkedHashMap<>();
        responseData.put("razorpayOrderId", created.gatewayOrderId());
        responseData.put("razorpayKeyId", created.keyId());
        responseData.put("amount", created.amountMinor());
        responseData.put("currency", created.currency());
        responseData.put("receipt", order.getId());
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("order_id", created.gatewayOrderId());
        response.put("status", "created");
        response.put("response_data", responseData);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("originalRequest", originalRequest);
        root.put("response", response);
        try {
            return objectMapper.writeValueAsString(root);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("payment log JSON could not be written", e);
        }
    }

    // ------------------------------------------------------------------ price and limits

    private CartPriceSnapshot price(String instituteId, Clean clean) {
        Map<String, Object> shipping = clean.shippingAddress();
        CartPriceRequest cart = CartPriceRequest.builder()
                .lines(clean.lines())
                .couponCode(clean.couponCode())
                .pincode((String) shipping.get("pincode"))
                .stateCode((String) shipping.get("state_code"))
                .paymentMethod(CartPriceRequest.PREPAID)
                .locale(clean.locale())
                .email(clean.email())
                .build();
        CommerceOrderService.CartPrice priced;
        try {
            priced = orderService.priceCart(instituteId, cart);
        } catch (CartPricingException e) {
            boolean invalid = CartPricingException.CART_INVALID.equals(e.getCode());
            throw new CheckoutException(invalid ? HttpStatus.BAD_REQUEST : HttpStatus.CONFLICT,
                    invalid ? CheckoutException.INVALID_REQUEST : CheckoutException.NOT_PRICEABLE, e.getMessage());
        }
        CartPriceSnapshot snapshot = priced.snapshot();
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("price", priced.view());
        if (priced.view().getUnavailable() != null && !priced.view().getUnavailable().isEmpty()) {
            throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.CART_CHANGED,
                    "An item in the cart can no longer be bought as asked.", details);
        }
        if (snapshot.getLines() == null || snapshot.getLines().isEmpty() || snapshot.getTax() == null) {
            throw CheckoutException.invalid("The cart is empty.");
        }
        if (snapshot.getPlaceOfSupplyState() == null) {
            // The state of the address decides the tax head: no order without it.
            throw CheckoutException.invalid("The delivery address needs a valid pincode or state.");
        }
        if (snapshot.getTotal() == null || snapshot.getTotal().compareTo(clean.expectedTotal()) != 0) {
            throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.PRICE_CHANGED,
                    "The total of the cart has changed.", details);
        }
        if (snapshot.getTotal().signum() <= 0) {
            throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.NOT_PRICEABLE,
                    "An order with nothing to pay cannot be placed online.");
        }
        return snapshot;
    }

    /** One hit on a database limit of this address; over the limit is 429, a limiter fault 503. */
    private void requireUnderAddressLimit(String instituteId, String scope, String clientIp, Duration window,
                                          int limit) {
        if (!StringUtils.hasText(clientIp)) {
            return; // no address is known for this call; the per-key limits of the route stand
        }
        boolean allowed;
        try {
            allowed = rateLimiter.allow(instituteId, scope, clientIp.trim(), window, limit);
        } catch (RuntimeException e) {
            // A limiter that cannot count must not turn into unlimited holds.
            log.error("COMMERCE_ALERT checkout rate limiter failed for scope {}: {}", scope,
                    e.getClass().getSimpleName());
            throw new CheckoutException(HttpStatus.SERVICE_UNAVAILABLE, CheckoutException.NOT_CONFIGURED,
                    "The order could not be placed right now. Please try again.");
        }
        if (!allowed) {
            throw new CheckoutException(HttpStatus.TOO_MANY_REQUESTS, CheckoutException.RATE_LIMITED,
                    "Too many orders from this network. Please try again in a few minutes.");
        }
    }

    private void requireUnderOpenOrderCap(String instituteId, Clean clean, boolean verified) {
        Long byPhone = primary.execute(status -> orderRepository.countOpenUnpaidByPhone(instituteId, clean.phone()));
        Long byEmail = clean.email() == null ? Long.valueOf(0)
                : primary.execute(status -> orderRepository.countOpenUnpaidByEmail(instituteId, clean.email()));
        long open = Math.max(byPhone == null ? 0 : byPhone, byEmail == null ? 0 : byEmail);
        if (open < MAX_OPEN_UNPAID_ORDERS) {
            return;
        }
        // Past the cap a shopper goes on only with a phone proved by OTP, up to a second cap.
        if (!verified || open >= MAX_OPEN_UNPAID_ORDERS_VERIFIED) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("otp_allows_more", !verified);
            throw new CheckoutException(HttpStatus.TOO_MANY_REQUESTS, CheckoutException.TOO_MANY_OPEN_ORDERS,
                    "You have orders waiting for payment. Pay or wait for them to lapse, then try again.",
                    details);
        }
    }

    // ------------------------------------------------------------------ validation

    Clean validate(CheckoutRequest request) {
        if (request == null) {
            throw CheckoutException.invalid("The request has no body.");
        }
        String requestId = trim(request.getClientRequestId());
        if (requestId == null || !REQUEST_ID.matcher(requestId).matches()) {
            throw CheckoutException.invalid(
                    "client_request_id is required: 8 to 64 letters, digits, hyphens or underscores.");
        }
        List<CartPriceRequest.Line> lines = request.getLines();
        if (lines == null || lines.isEmpty()) {
            throw CheckoutException.invalid("The cart is empty.");
        }
        if (lines.size() > CommerceOrderService.MAX_LINES) {
            throw CheckoutException.invalid("A cart holds at most " + CommerceOrderService.MAX_LINES + " lines.");
        }
        paymentMethod(request.getPaymentMethod());
        BigDecimal expected = request.getExpectedTotal();
        if (expected == null || expected.signum() < 0 || expected.scale() > 2
                || expected.precision() - expected.scale() > 10) {
            throw CheckoutException.invalid("expected_total is required: the total the cart showed.");
        }

        CheckoutRequest.Customer customer = request.getCustomer();
        if (customer == null) {
            throw CheckoutException.invalid("customer is required.");
        }
        String name = text(customer.getName(), "customer.name", 200, true);
        String phone = CommercePhones.normalise(customer.getPhone());
        if (phone == null) {
            throw CheckoutException.invalid("customer.phone is not a valid phone number.");
        }
        String email = trim(customer.getEmail());
        if (email != null) {
            email = email.toLowerCase(Locale.ROOT);
            if (email.length() > 320 || !EMAIL.matcher(email).matches()) {
                throw CheckoutException.invalid("customer.email is not a valid e-mail address.");
            }
        }

        if (request.getShippingAddress() == null) {
            throw CheckoutException.invalid("shipping_address is required.");
        }
        Map<String, Object> shipping = address(request.getShippingAddress(), "shipping_address", name, phone);
        Map<String, Object> billing = request.getBillingAddress() == null ? null
                : address(request.getBillingAddress(), "billing_address", name, phone);

        String gstin = trim(request.getBuyerGstin());
        if (gstin != null) {
            gstin = GstinValidator.normalise(gstin);
            if (!GstinValidator.isValid(gstin)) {
                throw CheckoutException.invalid("buyer_gstin is not a valid GSTIN.");
            }
        }

        CommerceCustomerService.AddressInput remember = null;
        if (Boolean.TRUE.equals(request.getSaveAddress())) {
            CheckoutRequest.Address a = request.getShippingAddress();
            remember = new CommerceCustomerService.AddressInput(text(a.getLabel(), "shipping_address.label", 64, false),
                    (String) shipping.get("name"), (String) shipping.get("phone"), (String) shipping.get("line1"),
                    (String) shipping.get("line2"), (String) shipping.get("landmark"), (String) shipping.get("city"),
                    (String) shipping.get("state_code"), (String) shipping.get("pincode"),
                    Boolean.TRUE.equals(a.getIsDefault()));
        }
        return new Clean(requestId, lines, text(request.getCouponCode(), "coupon_code", 64, false),
                text(request.getLocale(), "locale", 16, false), expected.setScale(2), name, phone, email, shipping,
                billing, remember, Boolean.TRUE.equals(request.getMarketingConsent()), gstin,
                text(request.getCustomerNote(), "customer_note", 500, false),
                text(request.getGiftNote(), "gift_note", 500, false),
                text(request.getChallengeToken(), "challenge_token", 2048, false),
                text(request.getPhoneToken(), "phone_token", 2048, false));
    }

    /**
     * The one place the payment method of an online order is decided. Prepaid is built; COD is
     * a later package and plugs in here (OTP first, limits, holds sold at placement, no gateway order).
     */
    static String paymentMethod(String asked) {
        String method = trim(asked);
        if (method == null || CartPriceRequest.PREPAID.equalsIgnoreCase(method)) {
            return CartPriceRequest.PREPAID;
        }
        if (CartPriceRequest.COD.equalsIgnoreCase(method)) {
            throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.PAYMENT_METHOD_NOT_AVAILABLE,
                    "Cash on delivery is not available yet.");
        }
        throw CheckoutException.invalid("payment_method is PREPAID or COD.");
    }

    /** An address as the order stores it: snake_case keys, trimmed, capped, validated. */
    static Map<String, Object> address(CheckoutRequest.Address a, String field, String defaultName,
                                       String defaultPhone) {
        String pincode = trim(a.getPincode());
        if (pincode != null) {
            pincode = pincode.replace(" ", "");
        }
        if (pincode == null || !PINCODE.matcher(pincode).matches()) {
            throw CheckoutException.invalid(field + ".pincode needs six digits.");
        }
        String state = trim(a.getStateCode());
        if (state != null && !PincodeStates.isStateCode(state)) {
            throw CheckoutException.invalid(field + ".state_code is not a GST state code.");
        }
        String phone = defaultPhone;
        if (trim(a.getPhone()) != null) {
            phone = CommercePhones.normalise(a.getPhone());
            if (phone == null) {
                throw CheckoutException.invalid(field + ".phone is not a valid phone number.");
            }
        }
        String name = text(a.getName(), field + ".name", 200, false);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name == null ? defaultName : name);
        out.put("phone", phone);
        out.put("line1", text(a.getLine1(), field + ".line1", 300, true));
        out.put("line2", text(a.getLine2(), field + ".line2", 300, false));
        out.put("landmark", text(a.getLandmark(), field + ".landmark", 200, false));
        out.put("city", text(a.getCity(), field + ".city", 100, false));
        out.put("state_code", state);
        out.put("pincode", pincode);
        return out;
    }

    /**
     * SHA-256 over what makes two checkouts the same order: the lines, the buyer, the address,
     * the coupon and the total the shopper agreed to. Tokens (challenge, phone) are left out:
     * they change between a request and its retry.
     */
    static String requestHash(Clean clean) {
        StringBuilder text = new StringBuilder(512);
        for (CartPriceRequest.Line line : clean.lines()) {
            text.append("L|").append(part(line.getVariantId())).append('|').append(part(line.getSku())).append('|')
                    .append(line.getQuantity() == null ? "" : line.getQuantity()).append('\n');
        }
        text.append("C|").append(part(clean.couponCode())).append('\n');
        text.append("T|").append(clean.expectedTotal().toPlainString()).append('\n');
        text.append("B|").append(part(clean.name())).append('|').append(part(clean.phone())).append('|')
                .append(part(clean.email())).append('|').append(part(clean.buyerGstin())).append('\n');
        text.append("S|").append(addressPart(clean.shippingAddress())).append('\n');
        text.append("I|").append(addressPart(clean.billingAddress())).append('\n');
        text.append("N|").append(part(clean.customerNote())).append('|').append(part(clean.giftNote())).append('\n');
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    private static String addressPart(Map<String, Object> address) {
        if (address == null) {
            return "";
        }
        StringBuilder text = new StringBuilder();
        for (Map.Entry<String, Object> entry : address.entrySet()) {
            text.append(entry.getKey()).append('=').append(part(entry.getValue() == null ? null
                    : entry.getValue().toString())).append(';');
        }
        return text.toString();
    }

    /** Length-prefixed, so that no two different inputs give the same text. */
    private static String part(String value) {
        String v = trim(value);
        return v == null ? "0:" : v.length() + ":" + v;
    }

    private static String text(String value, String field, int max, boolean required) {
        String v = trim(value);
        if (v == null) {
            if (required) {
                throw CheckoutException.invalid(field + " is required.");
            }
            return null;
        }
        if (v.length() > max) {
            throw CheckoutException.invalid(field + " is longer than " + max + " characters.");
        }
        for (int i = 0; i < v.length(); i++) {
            char c = v.charAt(i);
            if (c < 0x20 && c != '\n' && c != '\t') {
                throw CheckoutException.invalid(field + " contains a control character.");
            }
        }
        return v;
    }

    private static String trim(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim();
        return v.isEmpty() ? null : v;
    }
}
