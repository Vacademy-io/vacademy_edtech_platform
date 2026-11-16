package vacademy.io.admin_core_service.features.commerce.returns.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGateway;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGatewayException;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundMethod;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundStatus;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Sends a gateway refund to Razorpay, exactly once per refund row, and asks about its outcome.
 * Never inside a transaction: each step is a short transaction of its own and the remote calls
 * run between them.
 *
 * <ol>
 *   <li>Claim: PENDING to IN_PROGRESS by compare-and-set; whoever loses (another pod, the poll, a
 *       replayed request) does nothing.</li>
 *   <li>Check the payment (no create yet): not captured, or not enough left, fails the refund;
 *       a gateway that does not answer puts it back to PENDING with a backoff (failed after
 *       {@value #MAX_ATTEMPTS} tries).</li>
 *   <li>Create, with our refund id as the receipt. The answer is stored; processed and failed
 *       finish the refund, pending waits for the webhook or the poll. An error of the create
 *       leaves it IN_PROGRESS: the create is never sent again for this row, the poll finds the
 *       refund by its receipt or fails it when none exists after {@value #NOT_CREATED_MINUTES}
 *       minutes.</li>
 * </ol>
 */
@Slf4j
@Service
public class CommerceRefundExecutor {

    static final int MAX_ATTEMPTS = 5;
    static final int NOT_CREATED_MINUTES = 15;
    static final long RECHECK_MILLIS = 2L * 60 * 1000;
    static final int MAX_BACKOFF_MINUTES = 60;
    static final int MAX_POLL_MINUTES = 360;

    public static final String GATEWAY_FAILED = "GATEWAY_FAILED";
    public static final String GATEWAY_NOT_CREATED = "GATEWAY_NOT_CREATED";
    public static final String GATEWAY_BALANCE_SHORT = "GATEWAY_BALANCE_SHORT";
    public static final String PAYMENT_NOT_CAPTURED = "PAYMENT_NOT_CAPTURED";

    private final CommerceRefundRepository refundRepository;
    private final CommerceRefundService refundService;
    private final CommercePaymentGateway gateway;
    private final TransactionTemplate ownTransaction;

    public CommerceRefundExecutor(CommerceRefundRepository refundRepository, CommerceRefundService refundService,
                                  CommercePaymentGateway gateway, PlatformTransactionManager transactionManager) {
        this.refundRepository = refundRepository;
        this.refundService = refundService;
        this.gateway = gateway;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** What one execute did; for the tests and the poll's counts. */
    public enum Result { NOT_CLAIMED, FAILED, RETRY_LATER, PROCESSED, PENDING_AT_GATEWAY, CREATE_UNKNOWN }

    public Result execute(String refundId) {
        return execute(refundId, new Date());
    }

    public Result execute(String refundId, Date now) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("A gateway refund is executed with no transaction open");
        }
        Integer claimed = ownTransaction.execute(status -> refundRepository.claim(refundId, now,
                new Date(now.getTime() + RECHECK_MILLIS)));
        if (claimed == null || claimed != 1) {
            return Result.NOT_CLAIMED;
        }
        CommerceRefund refund = ownTransaction.execute(status -> refundRepository.findById(refundId).orElse(null));
        if (refund == null) {
            return Result.NOT_CLAIMED;
        }
        long amountMinor = CommerceRefundService.toMinor(refund.getAmount(), refund.getCurrency());

        // 2. Check the payment before anything is created.
        CommercePaymentGateway.GatewayPayment payment;
        try {
            payment = gateway.fetchPayment(refund.getInstituteId(), refund.getGatewayPaymentId());
        } catch (CommercePaymentGatewayException e) {
            if (CommercePaymentGatewayException.NOT_CONFIGURED.equals(e.getCode())
                    || CommercePaymentGatewayException.INVALID_REQUEST.equals(e.getCode())) {
                refundService.markFailed(refundId, e.getCode(), e.getMessage());
                return Result.FAILED;
            }
            return retryLater(refund, now, e.getMessage());
        } catch (RuntimeException e) {
            return retryLater(refund, now, e.getClass().getSimpleName());
        }
        if (payment == null || !"captured".equals(payment.status())) {
            refundService.markFailed(refundId, PAYMENT_NOT_CAPTURED, "the payment is "
                    + (payment == null ? "unknown" : payment.status()) + " at the gateway");
            return Result.FAILED;
        }
        if (payment.currency() == null || !payment.currency().equalsIgnoreCase(refund.getCurrency())
                || payment.amountMinor() - payment.amountRefundedMinor() < amountMinor) {
            refundService.markFailed(refundId, GATEWAY_BALANCE_SHORT, "the payment has "
                    + (payment.amountMinor() - payment.amountRefundedMinor()) + " left to refund, " + amountMinor
                    + " asked");
            return Result.FAILED;
        }

        // 3. Create, once.
        Map<String, String> notes = new LinkedHashMap<>();
        notes.put("commerce_order_id", refund.getOrderId());
        notes.put("commerce_refund_id", refund.getId());
        notes.put("institute_id", refund.getInstituteId());
        CommercePaymentGateway.GatewayRefund created;
        try {
            created = gateway.createRefund(refund.getInstituteId(), refund.getGatewayPaymentId(), amountMinor,
                    refund.getId(), notes);
        } catch (RuntimeException e) {
            String error = e instanceof CommercePaymentGatewayException g ? g.getCode() + ": " + g.getMessage()
                    : e.getClass().getSimpleName();
            ownTransaction.executeWithoutResult(status -> refundRepository.noteError(refundId,
                    CommerceRefundService.clip(error, 500)));
            log.warn("Commerce refund {}: the gateway create did not answer clearly ({}); the poll decides",
                    refundId, error);
            return Result.CREATE_UNKNOWN;
        }
        return apply(refund, created, now, true);
    }

    /**
     * The poll's step for one IN_PROGRESS refund (and {@code POST /refunds/{id}/check}): ask the
     * gateway; processed and failed finish it; otherwise it is asked again later. A refund never
     * created (no refund with our receipt) fails once {@value #NOT_CREATED_MINUTES} minutes have
     * passed since the claim. A gateway error only reschedules.
     */
    public Result check(String refundId, Date now) {
        CommerceRefund refund = ownTransaction.execute(status -> refundRepository.findById(refundId).orElse(null));
        if (refund == null || !RefundMethod.GATEWAY.name().equals(refund.getMethod())
                || !RefundStatus.IN_PROGRESS.name().equals(refund.getStatus())) {
            return Result.NOT_CLAIMED;
        }
        CommercePaymentGateway.GatewayRefund found;
        try {
            if (refund.getGatewayRefundId() != null) {
                found = gateway.fetchRefund(refund.getInstituteId(), refund.getGatewayPaymentId(),
                        refund.getGatewayRefundId());
            } else {
                found = null;
                List<CommercePaymentGateway.GatewayRefund> all = gateway.fetchRefunds(refund.getInstituteId(),
                        refund.getGatewayPaymentId());
                for (CommercePaymentGateway.GatewayRefund candidate : all) {
                    if (refund.getId().equals(candidate.receipt())) {
                        found = candidate;
                        break;
                    }
                }
                if (found == null) {
                    Date claimedAt = refund.getClaimedAt();
                    if (claimedAt != null && claimedAt.getTime() <= now.getTime() - NOT_CREATED_MINUTES * 60_000L) {
                        refundService.markFailed(refundId, GATEWAY_NOT_CREATED,
                                "no refund with this receipt exists at the gateway");
                        return Result.FAILED;
                    }
                    reschedule(refund, now, null);
                    return Result.RETRY_LATER;
                }
            }
        } catch (RuntimeException e) {
            reschedule(refund, now, null);
            return Result.RETRY_LATER;
        }
        return apply(refund, found, now, false);
    }

    /** The gateway's answer about the refund: stored, then processed, failed or asked again later. */
    Result apply(CommerceRefund refund, CommercePaymentGateway.GatewayRefund answer, Date now, boolean fromCreate) {
        if (answer == null) {
            return Result.CREATE_UNKNOWN;
        }
        long ours = CommerceRefundService.toMinor(refund.getAmount(), refund.getCurrency());
        if (answer.amountMinor() >= 0 && answer.amountMinor() != ours) {
            log.error("COMMERCE_ALERT refund_amount_mismatch refund={} gateway_refund={} ours={} gateway={}",
                    refund.getId(), answer.id(), ours, answer.amountMinor());
            reschedule(refund, now, answer.status());
            return Result.RETRY_LATER;
        }
        if (answer.id() != null) {
            ownTransaction.executeWithoutResult(status -> refundRepository.storeGatewayRefund(refund.getId(),
                    answer.id(), CommerceRefundService.clip(answer.status(), 32),
                    CommerceRefundService.clip(answer.bankReference(), 100)));
        }
        String status = answer.status() == null ? "" : answer.status();
        switch (status) {
            case "processed" -> {
                refundService.markProcessed(refund.getId(),
                        CommerceRefundService.Facts.gateway(status, answer.bankReference()));
                return Result.PROCESSED;
            }
            case "failed" -> {
                refundService.markFailed(refund.getId(), GATEWAY_FAILED, "the gateway reports the refund failed",
                        status);
                return Result.FAILED;
            }
            default -> {
                if (!fromCreate) {
                    reschedule(refund, now, status.isEmpty() ? null : status);
                }
                // Just created: the claim already set the first check two minutes on.
                return Result.PENDING_AT_GATEWAY;
            }
        }
    }

    /** No create was sent: back to PENDING, tried again after 2^attempt minutes; failed after the last try. */
    private Result retryLater(CommerceRefund refund, Date now, String error) {
        int attempts = refund.getAttemptCount() == null ? 1 : refund.getAttemptCount();
        if (attempts >= MAX_ATTEMPTS) {
            refundService.markFailed(refund.getId(), CommercePaymentGatewayException.UNAVAILABLE,
                    "the gateway did not answer after " + attempts + " tries");
            return Result.FAILED;
        }
        long minutes = Math.min(1L << Math.min(attempts, 10), MAX_BACKOFF_MINUTES);
        Date next = new Date(now.getTime() + minutes * 60_000L);
        ownTransaction.executeWithoutResult(status -> refundRepository.release(refund.getId(), next,
                CommerceRefundService.clip(error, 500)));
        return Result.RETRY_LATER;
    }

    private void reschedule(CommerceRefund refund, Date now, String gatewayStatus) {
        int polls = refund.getPollCount() == null ? 0 : refund.getPollCount();
        long minutes = Math.min(1L << Math.min(polls, 10), MAX_POLL_MINUTES);
        Date next = new Date(now.getTime() + minutes * 60_000L);
        ownTransaction.executeWithoutResult(status -> refundRepository.reschedule(refund.getId(), now, next,
                CommerceRefundService.clip(gatewayStatus, 32)));
    }
}
