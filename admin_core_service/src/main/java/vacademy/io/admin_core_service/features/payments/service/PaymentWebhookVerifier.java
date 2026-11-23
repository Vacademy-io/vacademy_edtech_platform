package vacademy.io.admin_core_service.features.payments.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.manager.CashfreePaymentManager;
import vacademy.io.admin_core_service.features.payments.manager.PhonePePaymentManager;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService.WebhookOrderMatch;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.common.payment.dto.PhonePeStatusResponseDTO;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Confirms a Cashfree or PhonePe webhook's claim with the gateway before a payment log
 * changes status.
 *
 * <p>The payment logs are found by an exact match of the gateway order id for that gateway
 * ({@link PaymentLogService#matchWebhookOrder}); the institute is the one that owns those
 * logs, never the request's {@code instituteId}; that institute's credentials are used to
 * read the order back from the gateway (Cashfree get-order, PhonePe status API), and its
 * status (and amount, for a paid claim) must agree with the webhook.
 *
 * <p>Per-gateway mode, {@code payments.webhook.verify.cashfree} and
 * {@code payments.webhook.verify.phonepe}:
 * <ul>
 *   <li>{@code log} (default): the webhook is processed exactly as before; after it has been
 *       processed, the read-back runs on a background thread and its outcome is written to
 *       the log as {@code WEBHOOK_VERIFY ... result=...} (WARN when not ok).</li>
 *   <li>{@code enforce}: the status changes only when the outcome is ok. A gateway answer
 *       that disagrees is acknowledged (HTTP 200) without a change; when the gateway could
 *       not be asked or the log is not there yet, the caller answers 5xx so the gateway
 *       retries.</li>
 * </ul>
 * Amounts are compared, currencies are not (stored currencies are blank or differ in case
 * on some logs).
 */
@Slf4j
@Component
public class PaymentWebhookVerifier {

    public enum Mode {
        LOG, ENFORCE;

        public static Mode parse(String raw) {
            return raw != null && "enforce".equalsIgnoreCase(raw.trim()) ? ENFORCE : LOG;
        }
    }

    public enum Result {
        OK, LOG_NOT_FOUND, INSTITUTE_UNRESOLVED, STATUS_MISMATCH, AMOUNT_MISMATCH, FETCH_ERROR;

        public String code() {
            return name().toLowerCase();
        }
    }

    /**
     * @param result        verification result
     * @param instituteId   institute owning the matched payment logs (null when unresolved)
     * @param gatewayStatus status the gateway reported, when it was asked
     */
    public record Outcome(Result result, String instituteId, String gatewayStatus) {
        public boolean ok() {
            return result == Result.OK;
        }

        /** The gateway should deliver again later: it could not be asked, or the log is not there yet. */
        public boolean retryable() {
            return result == Result.FETCH_ERROR || result == Result.LOG_NOT_FOUND;
        }
    }

    public enum SignatureResult { MATCH, MISMATCH, MISSING_HEADERS, NO_SECRET, ERROR }

    private static final BigDecimal AMOUNT_TOLERANCE = new BigDecimal("0.01");

    private final PaymentLogService paymentLogService;
    private final InstitutePaymentGatewayMappingService gatewayMappingService;
    private final CashfreePaymentManager cashfreePaymentManager;
    private final PhonePePaymentManager phonePePaymentManager;
    private final Mode cashfreeMode;
    private final Mode phonePeMode;

    public PaymentWebhookVerifier(PaymentLogService paymentLogService,
            InstitutePaymentGatewayMappingService gatewayMappingService,
            CashfreePaymentManager cashfreePaymentManager,
            PhonePePaymentManager phonePePaymentManager,
            @Value("${payments.webhook.verify.cashfree:log}") String cashfreeMode,
            @Value("${payments.webhook.verify.phonepe:log}") String phonePeMode) {
        this.paymentLogService = paymentLogService;
        this.gatewayMappingService = gatewayMappingService;
        this.cashfreePaymentManager = cashfreePaymentManager;
        this.phonePePaymentManager = phonePePaymentManager;
        this.cashfreeMode = Mode.parse(cashfreeMode);
        this.phonePeMode = Mode.parse(phonePeMode);
    }

    /**
     * Runs the log-mode read-backs after a webhook has been processed. Small and bounded: when
     * it is full a check is skipped (and logged), never queued on the webhook thread.
     */
    private Executor afterApplyExecutor = new ThreadPoolExecutor(1, 2, 60, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(500),
            runnable -> {
                Thread thread = new Thread(runnable, "webhook-verify");
                thread.setDaemon(true);
                return thread;
            },
            (runnable, executor) -> log.warn("WEBHOOK_VERIFY check skipped: queue full"));

    /** For tests: run the after-apply checks on another executor (e.g. the calling thread). */
    void setAfterApplyExecutor(Executor executor) {
        this.afterApplyExecutor = executor;
    }

    public Mode cashfreeMode() {
        return cashfreeMode;
    }

    public Mode phonePeMode() {
        return phonePeMode;
    }

    // ── Log mode: check after the webhook was applied ────────────────────────

    /**
     * Log mode, Cashfree: after the webhook was processed as before, reads the order back and
     * checks the signature (live delivery only) on a background thread, writing only log lines.
     * Never throws and never blocks the caller.
     */
    public void checkCashfreeAfterApply(String webhookId, String orderId, PaymentStatusEnum claimed,
            String requestInstituteId, boolean checkSignature, String signature, String timestamp,
            String rawBody) {
        runAfterApply(PaymentGateway.CASHFREE.name(), orderId, () -> {
            Outcome outcome = verifyCashfree(orderId, claimed);
            if (checkSignature) {
                checkCashfreeSignature(outcome.instituteId() != null ? outcome.instituteId() : requestInstituteId,
                        timestamp, signature, rawBody, orderId);
            }
            report(PaymentGateway.CASHFREE.name(), Mode.LOG, webhookId, orderId, claimed, outcome,
                    requestInstituteId);
        });
    }

    /** Log mode, PhonePe: as {@link #checkCashfreeAfterApply}, with the status API. */
    public void checkPhonePeAfterApply(String webhookId, String merchantOrderId, PaymentStatusEnum claimed,
            String requestInstituteId) {
        runAfterApply(PaymentGateway.PHONEPE.name(), merchantOrderId, () -> {
            Outcome outcome = verifyPhonePe(merchantOrderId, claimed);
            report(PaymentGateway.PHONEPE.name(), Mode.LOG, webhookId, merchantOrderId, claimed, outcome,
                    requestInstituteId);
        });
    }

    private void runAfterApply(String vendor, String orderId, Runnable check) {
        try {
            afterApplyExecutor.execute(() -> {
                try {
                    check.run();
                } catch (Exception e) {
                    log.warn("WEBHOOK_VERIFY vendor={} orderId={} check failed: {}", vendor, orderId, e.getMessage());
                }
            });
        } catch (Exception e) {
            log.warn("WEBHOOK_VERIFY vendor={} orderId={} check not started: {}", vendor, orderId, e.getMessage());
        }
    }

    // ── Verification ─────────────────────────────────────────────────────────

    /** Verifies a Cashfree PAID/FAILED claim. Never throws. */
    public Outcome verifyCashfree(String orderId, PaymentStatusEnum claimed) {
        try {
            WebhookOrderMatch match = match(PaymentGateway.CASHFREE.name(), orderId);
            Outcome pre = preconditions(match);
            if (pre != null) {
                return pre;
            }
            String instituteId = singleInstitute(match);
            CashfreePaymentManager.CashfreeOrderStatus order;
            try {
                Map<String, Object> data = gatewayMappingService
                        .findInstitutePaymentGatewaySpecifData(PaymentGateway.CASHFREE.name(), instituteId);
                order = cashfreePaymentManager.fetchOrder(orderId, data);
            } catch (Exception e) {
                log.warn("WEBHOOK_VERIFY vendor=CASHFREE orderId={} could not read the order: {}", orderId,
                        e.getMessage());
                return new Outcome(Result.FETCH_ERROR, instituteId, null);
            }
            String status = upper(order.getOrderStatus());
            if (claimed == PaymentStatusEnum.PAID) {
                if (!"PAID".equals(status)) {
                    return new Outcome(Result.STATUS_MISMATCH, instituteId, status);
                }
                if (!amountMatches(order.getOrderAmount(), match)) {
                    return new Outcome(Result.AMOUNT_MISMATCH, instituteId, status);
                }
                return new Outcome(Result.OK, instituteId, status);
            }
            // FAILED is applied as before unless the gateway says the order is paid.
            return new Outcome("PAID".equals(status) ? Result.STATUS_MISMATCH : Result.OK, instituteId, status);
        } catch (Exception e) {
            log.warn("WEBHOOK_VERIFY vendor=CASHFREE orderId={} verification error: {}", orderId, e.getMessage());
            return new Outcome(Result.FETCH_ERROR, null, null);
        }
    }

    /** Verifies a PhonePe PAID/FAILED claim with the status API checkout already uses. Never throws. */
    public Outcome verifyPhonePe(String merchantOrderId, PaymentStatusEnum claimed) {
        try {
            WebhookOrderMatch match = match(PaymentGateway.PHONEPE.name(), merchantOrderId);
            Outcome pre = preconditions(match);
            if (pre != null) {
                return pre;
            }
            String instituteId = singleInstitute(match);
            PhonePeStatusResponseDTO status;
            try {
                Map<String, Object> data = gatewayMappingService
                        .findInstitutePaymentGatewaySpecifData(PaymentGateway.PHONEPE.name(), instituteId);
                status = phonePePaymentManager.checkPaymentStatusWithTimeouts(merchantOrderId, data);
            } catch (Exception e) {
                log.warn("WEBHOOK_VERIFY vendor=PHONEPE orderId={} could not read the order: {}", merchantOrderId,
                        e.getMessage());
                return new Outcome(Result.FETCH_ERROR, instituteId, null);
            }
            if (status == null || !StringUtils.hasText(status.getState()) || isLocalFailure(status)) {
                return new Outcome(Result.FETCH_ERROR, instituteId, null);
            }
            String state = upper(status.getState());
            if (claimed == PaymentStatusEnum.PAID) {
                if (!"COMPLETED".equals(state)) {
                    return new Outcome(Result.STATUS_MISMATCH, instituteId, state);
                }
                BigDecimal rupees = status.getAmount() == null ? null
                        : BigDecimal.valueOf(status.getAmount()).movePointLeft(2);
                if (!amountMatches(rupees, match)) {
                    return new Outcome(Result.AMOUNT_MISMATCH, instituteId, state);
                }
                return new Outcome(Result.OK, instituteId, state);
            }
            return new Outcome("FAILED".equals(state) ? Result.OK : Result.STATUS_MISMATCH, instituteId, state);
        } catch (Exception e) {
            log.warn("WEBHOOK_VERIFY vendor=PHONEPE orderId={} verification error: {}", merchantOrderId,
                    e.getMessage());
            return new Outcome(Result.FETCH_ERROR, null, null);
        }
    }

    /**
     * The order's payment logs by exact match, with a WARN when the lookup used so far would
     * pick different logs for the same order id.
     */
    WebhookOrderMatch match(String vendor, String orderId) {
        WebhookOrderMatch match = paymentLogService.matchWebhookOrder(orderId, vendor);
        if (match.legacyLogIds() != null
                && !new HashSet<>(match.legacyLogIds()).equals(new HashSet<>(match.logIds()))) {
            log.warn("WEBHOOK_LOOKUP vendor={} orderId={} result=lookup_differs exact={} legacy={}",
                    vendor, orderId, match.logIds(), match.legacyLogIds());
        }
        return match;
    }

    private static Outcome preconditions(WebhookOrderMatch match) {
        if (match.logIds().isEmpty()) {
            return new Outcome(Result.LOG_NOT_FOUND, null, null);
        }
        if (singleInstitute(match) == null) {
            return new Outcome(Result.INSTITUTE_UNRESOLVED, null, null);
        }
        return null;
    }

    /** The one institute every matched log belongs to, or null when unknown or more than one. */
    private static String singleInstitute(WebhookOrderMatch match) {
        Set<String> institutes = match.instituteIds();
        if (institutes == null || institutes.size() != 1) {
            return null;
        }
        String only = institutes.iterator().next();
        return StringUtils.hasText(only) ? only : null;
    }

    /**
     * The gateway amount equals the amount of a matched log that is not a multi-package child
     * (the parent of a multi-package order holds the order total), or the sum of all matched
     * logs, within 0.01.
     */
    static boolean amountMatches(BigDecimal gatewayAmount, WebhookOrderMatch match) {
        if (gatewayAmount == null) {
            return false;
        }
        List<BigDecimal> candidates = new ArrayList<>();
        BigDecimal sum = BigDecimal.ZERO;
        for (int i = 0; i < match.logIds().size(); i++) {
            Double amount = match.amounts().get(i);
            if (amount == null) {
                continue;
            }
            BigDecimal value = BigDecimal.valueOf(amount);
            sum = sum.add(value);
            Set<String> children = match.childLogIds();
            if (children == null || !children.contains(match.logIds().get(i))) {
                candidates.add(value);
            }
        }
        candidates.add(sum);
        for (BigDecimal candidate : candidates) {
            if (candidate.subtract(gatewayAmount).abs().compareTo(AMOUNT_TOLERANCE) <= 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * PhonePePaymentManager.checkPaymentStatus reports its own errors (network, auth, an
     * unsuccessful response) as a bare FAILED state carrying nothing else; a real gateway
     * answer always carries the order amount or PhonePe's order id.
     */
    private static boolean isLocalFailure(PhonePeStatusResponseDTO status) {
        return "FAILED".equalsIgnoreCase(status.getState()) && status.getAmount() == null
                && status.getOrderId() == null && status.getPaymentDetails() == null
                && status.getErrorCode() == null;
    }

    // ── Cashfree signature ───────────────────────────────────────────────────

    /** Base64(HMAC-SHA256(secret, timestamp + rawBody)), as Cashfree signs webhooks. */
    public static String cashfreeSignature(String secret, String timestamp, String rawBody) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal((timestamp + rawBody).getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(digest);
        } catch (Exception e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }

    /**
     * Checks the Cashfree webhook signature with the institute's client secret (constant-time
     * compare) and writes the result to the log. The signature decides nothing yet: the
     * order read-back is the check that is enforced.
     */
    public SignatureResult checkCashfreeSignature(String instituteId, String timestamp, String signature,
            String rawBody, String orderId) {
        SignatureResult result;
        if (!StringUtils.hasText(signature) || !StringUtils.hasText(timestamp)) {
            result = SignatureResult.MISSING_HEADERS;
        } else if (!StringUtils.hasText(instituteId)) {
            result = SignatureResult.NO_SECRET;
        } else {
            try {
                Map<String, Object> data = gatewayMappingService
                        .findInstitutePaymentGatewaySpecifData(PaymentGateway.CASHFREE.name(), instituteId);
                Object secret = data != null ? data.get("clientSecret") : null;
                if (!(secret instanceof String s) || !StringUtils.hasText(s)) {
                    result = SignatureResult.NO_SECRET;
                } else {
                    String expected = cashfreeSignature(s.trim(), timestamp, rawBody == null ? "" : rawBody);
                    result = MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                            signature.trim().getBytes(StandardCharsets.UTF_8))
                            ? SignatureResult.MATCH : SignatureResult.MISMATCH;
                }
            } catch (Exception e) {
                result = SignatureResult.ERROR;
            }
        }
        if (result == SignatureResult.MATCH) {
            log.info("WEBHOOK_SIGNATURE vendor=CASHFREE orderId={} result=match", orderId);
        } else {
            log.warn("WEBHOOK_SIGNATURE vendor=CASHFREE orderId={} result={}", orderId, result.name().toLowerCase());
        }
        return result;
    }

    // ── Reporting ────────────────────────────────────────────────────────────

    /**
     * One line per verified webhook: {@code WEBHOOK_VERIFY vendor=... mode=... result=...}.
     * WARN (and a Sentry warning) when the result is not ok or the request named a different
     * institute than the one owning the logs. Ids and statuses only; no payload, no secrets.
     */
    public void report(String vendor, Mode mode, String webhookId, String orderId, PaymentStatusEnum claimed,
            Outcome outcome, String requestInstituteId) {
        boolean instituteMismatch = outcome.instituteId() != null && StringUtils.hasText(requestInstituteId)
                && !Objects.equals(outcome.instituteId(), requestInstituteId);
        if (outcome.ok() && !instituteMismatch) {
            log.info("WEBHOOK_VERIFY vendor={} mode={} orderId={} webhookId={} claimed={} result=ok gatewayStatus={}",
                    vendor, mode, orderId, webhookId, claimed, outcome.gatewayStatus());
            return;
        }
        log.warn("WEBHOOK_VERIFY vendor={} mode={} orderId={} webhookId={} claimed={} result={} gatewayStatus={}"
                        + " instituteMismatch={}",
                vendor, mode, orderId, webhookId, claimed, outcome.result().code(), outcome.gatewayStatus(),
                instituteMismatch);
        try {
            SentryLogger.logWarning("Payment webhook verification: " + outcome.result().code(), Map.of(
                    "payment.vendor", vendor,
                    "payment.webhook.mode", mode.name(),
                    "payment.webhook.result", outcome.result().code(),
                    "payment.webhook.institute_mismatch", String.valueOf(instituteMismatch),
                    "order.id", String.valueOf(orderId)));
        } catch (Exception ignored) {
            // reporting must never affect webhook handling
        }
    }

    private static String upper(String value) {
        return value == null ? null : value.trim().toUpperCase();
    }
}
