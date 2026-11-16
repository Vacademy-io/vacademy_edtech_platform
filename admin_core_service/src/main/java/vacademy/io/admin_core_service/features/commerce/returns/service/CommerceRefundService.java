package vacademy.io.admin_core_service.features.commerce.returns.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommerceGatewayOrder;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommerceGatewayOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentException;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGateway;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGatewayException;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.returns.dto.RefundDtos;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundKind;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundMethod;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundSource;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundStatus;
import vacademy.io.admin_core_service.features.commerce.returns.enums.ReturnStatus;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.currency.CurrencyRegistry;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Refunds (WP-32): the money of an order given back, and the order's refund ledger.
 *
 * <p>On {@code commerce_order}, written only under the order row lock: {@code refund_due} (owed
 * back, raised by cancel, line cancel, RTO, return), {@code refund_committed} (ORDER refunds not
 * FAILED) and {@code amount_refunded} (ORDER refunds PROCESSED). A refund is capped by the open
 * due ({@code refund_due - refund_committed}), by what was paid, by its return's raised due and,
 * through the gateway, by what the payment captured. Two refunds that together pass a cap are
 * serialised by the order lock: the second sees the first's commitment and is refused.
 *
 * <p>Status moves are compare-and-set updates ({@link CommerceRefundRepository}): the executor,
 * the webhook, the poll and a staff route can all report the same outcome, and only the first
 * changes anything. PROCESSED and FAILED are final.
 *
 * <p>Nothing remote runs inside a transaction here: the gateway call is made by
 * {@link CommerceRefundExecutor} after the commit, and an adopted gateway refund is read before
 * the transaction.
 */
@Slf4j
@Service
public class CommerceRefundService {

    public static final String VENDOR = "RAZORPAY";
    public static final String REFUND_ABOVE_DUE = "REFUND_ABOVE_DUE";
    public static final String REFUND_ABOVE_RETURN = "REFUND_ABOVE_RETURN";
    public static final String REFUND_ABOVE_PAID = "REFUND_ABOVE_PAID";
    public static final String REFUND_METHOD_NOT_AVAILABLE = "REFUND_METHOD_NOT_AVAILABLE";
    public static final String GATEWAY_PAYMENT_UNKNOWN = "GATEWAY_PAYMENT_UNKNOWN";
    public static final String GATEWAY_REFUND_MISMATCH = "GATEWAY_REFUND_MISMATCH";
    public static final String REFUND_STATE_CHANGED = "REFUND_STATE_CHANGED";
    public static final String USE_EXCHANGE_ORDER = "USE_EXCHANGE_ORDER";
    public static final String CANCELLED = "CANCELLED";
    static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);
    static final Set<CommerceRole> READERS = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);
    private static final BigDecimal MAX_AMOUNT = new BigDecimal("9999999999.99");
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final long GATEWAY_RECHECK_MILLIS = 2L * 60 * 1000;

    private final CommerceOrderDeskService desk;
    private final CommerceOrderRepository orderRepository;
    private final CommerceRefundRepository refundRepository;
    private final CommerceReturnRepository returnRepository;
    private final CommerceGatewayOrderRepository gatewayOrders;
    private final CommercePaymentExceptionRepository exceptions;
    private final CommerceReturnDueService dueService;
    private final CommerceRequestGuard requestGuard;
    private final CommerceAccessGuard accessGuard;
    private final CommerceAuditService auditService;
    private final CommerceOrderEvents events;
    private final CommercePaymentGateway gateway;
    private final DocumentClock clock;
    private final ObjectProvider<StockPeriodGuard> periodGuard;
    private final ObjectProvider<CommerceRefundExecutor> executor;
    /** Joins the caller's transaction, or opens one. */
    private final TransactionTemplate transaction;
    /** Always a transaction of its own (reads after a commit). */
    private final TransactionTemplate ownTransaction;

    @PersistenceContext
    private EntityManager entityManager;

    public CommerceRefundService(CommerceOrderDeskService desk, CommerceOrderRepository orderRepository,
                                 CommerceRefundRepository refundRepository, CommerceReturnRepository returnRepository,
                                 CommerceGatewayOrderRepository gatewayOrders,
                                 CommercePaymentExceptionRepository exceptions, CommerceReturnDueService dueService,
                                 CommerceRequestGuard requestGuard, CommerceAccessGuard accessGuard,
                                 CommerceAuditService auditService, CommerceOrderEvents events,
                                 CommercePaymentGateway gateway, DocumentClock clock,
                                 ObjectProvider<StockPeriodGuard> periodGuard,
                                 ObjectProvider<CommerceRefundExecutor> executor,
                                 PlatformTransactionManager transactionManager) {
        this.desk = desk;
        this.orderRepository = orderRepository;
        this.refundRepository = refundRepository;
        this.returnRepository = returnRepository;
        this.gatewayOrders = gatewayOrders;
        this.exceptions = exceptions;
        this.dueService = dueService;
        this.requestGuard = requestGuard;
        this.accessGuard = accessGuard;
        this.auditService = auditService;
        this.events = events;
        this.gateway = gateway;
        this.clock = clock;
        this.periodGuard = periodGuard;
        this.executor = executor;
        this.transaction = new TransactionTemplate(transactionManager);
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** One refund to write; see {@link #insertInside}. */
    public record NewRefund(RefundKind kind, RefundSource source, RefundMethod method, RefundStatus status,
                            BigDecimal amount, String returnId, String creditNoteId, String gatewayPaymentId,
                            String gatewayRefundId, String gatewayStatus, String reference, String appliedOrderId,
                            LocalDate paidOn, String reason, String idempotencyKey, String actor) {
    }

    /** What an outcome brings: who, the payout or bank reference, the payout day, the gateway's word. */
    public record Facts(String actor, String reference, LocalDate paidOn, String gatewayStatus) {

        public static Facts gateway(String status, String bankReference) {
            return new Facts(null, bankReference, null, status);
        }
    }

    /** A validated {@code POST /refunds} body. */
    record Clean(String clientRequestId, String orderId, String returnId, BigDecimal amount, RefundMethod method,
                 String reference, LocalDate paidOn, String reason, String gatewayRefundId) {
    }

    // ================================================================== routes

    /** {@code POST /refunds}. Answers the refund; a GATEWAY one is sent to the gateway after the commit. */
    public RefundDtos.RefundView create(CustomUserDetails user, String instituteId,
                                        RefundDtos.CreateRefundRequest request) {
        Clean clean = validate(request, clock.today(instituteId));
        CommerceOrder seen = desk.readOrder(instituteId, clean.orderId());
        String location = seen.getFulfilmentLocationId();
        if (clean.returnId() != null) {
            CommerceReturn ret = readReturn(instituteId, clean.returnId());
            if (!seen.getId().equals(ret.getOrderId())) {
                throw new VacademyException(HttpStatus.NOT_FOUND, "RETURN_NOT_FOUND: no such return of this order");
            }
            location = ret.getLocationId();
        }
        desk.authorize(user, instituteId, location, MANAGER);
        CommercePaymentGateway.GatewayRefund adopted = clean.gatewayRefundId() == null ? null
                : readAdopted(instituteId, seen, clean);
        String actor = user.getUserId();
        String key = "REQ:" + clean.clientRequestId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId,
                        clean.clientRequestId(), "REFUND_CREATE", "ORDER", clean.orderId(),
                        CommerceRequestGuard.hash("REFUND_CREATE", request, clean.orderId()), actor),
                () -> createInside(instituteId, clean, adopted, key, actor),
                () -> refundRepository.findByInstituteIdAndIdempotencyKey(instituteId, key)
                        .map(CommerceRefund::getId).orElse(null));
        String refundId = outcome.value();
        executeIfPending(refundId);
        return view(instituteId, refundId, outcome.replayed());
    }

    String createInside(String instituteId, Clean clean, CommercePaymentGateway.GatewayRefund adopted, String key,
                        String actor) {
        CommerceOrder order = desk.lockOrder(instituteId, clean.orderId());
        if (CommerceOrderStatus.PENDING_PAYMENT.name().equals(order.getStatus())) {
            throw new ConflictException(CommerceOrderDeskService.ORDER_STATE_CHANGED + ": an unpaid order has "
                    + "nothing to refund");
        }
        BigDecimal amount = clean.amount();
        if (clean.returnId() != null) {
            CommerceReturn ret = lockReturn(instituteId, clean.returnId());
            if (!order.getId().equals(ret.getOrderId())) {
                throw new VacademyException(HttpStatus.NOT_FOUND, "RETURN_NOT_FOUND: no such return of this order");
            }
            if (!ReturnStatus.RECEIVED.name().equals(ret.getStatus())
                    && !ReturnStatus.CLOSED.name().equals(ret.getStatus())) {
                throw new ConflictException("RETURN_STATE_CHANGED: the return is " + ret.getStatus()
                        + "; only a received return is refunded");
            }
            BigDecimal left = ret.getDueRaised().subtract(nz(refundRepository.sumLiveOfReturn(ret.getId())));
            if (amount.compareTo(left) > 0) {
                throw new ConflictException(REFUND_ABOVE_RETURN + ": at most " + left.max(BigDecimal.ZERO)
                        .toPlainString() + " is left to refund on this return");
            }
        }
        requireWithinDue(order, amount);
        RefundStatus status;
        String paymentId = null;
        String gatewayRefundId = null;
        String gatewayStatus = null;
        String reference = clean.reference();
        LocalDate paidOn = null;
        LocalDate today = clock.today(instituteId);
        switch (clean.method()) {
            case GATEWAY -> {
                CommerceGatewayOrder paying = payingRow(order.getId());
                paymentId = paying.getGatewayPaymentId();
                long minor = toMinor(amount, order.getCurrency());
                long live = toMinor(nz(refundRepository.sumLiveGatewayOfPayment(VENDOR, paymentId)),
                        order.getCurrency());
                if (minor + live > paying.getAmountMinor()) {
                    throw new ConflictException(REFUND_ABOVE_PAID + ": the payment has less left to give back");
                }
                if (adopted != null) {
                    if (!paymentId.equals(adopted.paymentId())) {
                        throw new ConflictException(GATEWAY_REFUND_MISMATCH + ": the gateway refund is not on this "
                                + "order's payment");
                    }
                    if (refundRepository.findByGatewayVendorAndGatewayRefundId(VENDOR, adopted.id()).isPresent()) {
                        throw new ConflictException(GATEWAY_REFUND_MISMATCH + ": the gateway refund is recorded "
                                + "already");
                    }
                    gatewayRefundId = adopted.id();
                    gatewayStatus = adopted.status();
                    reference = adopted.bankReference();
                    status = "processed".equals(adopted.status()) ? RefundStatus.PROCESSED : RefundStatus.IN_PROGRESS;
                } else {
                    status = RefundStatus.PENDING;
                    reference = null;
                }
            }
            case BANK_TRANSFER, UPI -> {
                status = reference != null ? RefundStatus.PROCESSED : RefundStatus.PENDING;
                paidOn = reference != null ? (clean.paidOn() == null ? today : clean.paidOn()) : null;
            }
            case CASH -> {
                status = RefundStatus.PROCESSED;
                paidOn = clean.paidOn() == null ? today : clean.paidOn();
            }
            default -> throw new ConflictException(USE_EXCHANGE_ORDER + ": an exchange is made with a new order");
        }
        if (paidOn != null && paidOn.isBefore(today)) {
            LocalDate day = paidOn;
            periodGuard.ifAvailable(guard -> guard.assertOpen(instituteId, day));
        }
        CommerceReturn ret = clean.returnId() == null ? null : returnRepository.findById(clean.returnId()).orElse(null);
        CommerceRefund refund = insertInside(order, new NewRefund(RefundKind.ORDER, RefundSource.STAFF, clean.method(),
                status, amount, clean.returnId(), ret == null ? null : ret.getCreditNoteId(), paymentId,
                gatewayRefundId, gatewayStatus, reference, null, paidOn, clean.reason(), key, actor));
        return refund.getId();
    }

    /** {@code POST /refunds/{id}/record-payout}: a pending bank or UPI refund was paid out by staff. */
    public RefundDtos.RefundView recordPayout(CustomUserDetails user, String instituteId, String refundId,
                                              RefundDtos.PayoutRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        String reference = text(request.getReference(), "reference", 100);
        if (reference == null) {
            throw validation("reference is required: the payout reference (UTR, UPI ref)");
        }
        LocalDate today = clock.today(instituteId);
        LocalDate paidOn = day(request.getPaidOn(), today);
        CommerceRefund seen = authorizeOn(user, instituteId, refundId, MANAGER);
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId,
                        key, "REFUND_PAYOUT", "REFUND", seen.getId(),
                        CommerceRequestGuard.hash("REFUND_PAYOUT", request, seen.getId()), actor),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, seen.getOrderId());
                    CommerceRefund refund = fresh(seen.getId());
                    RefundMethod method = RefundMethod.of(refund.getMethod());
                    if ((method != RefundMethod.BANK_TRANSFER && method != RefundMethod.UPI)
                            || !RefundStatus.PENDING.name().equals(refund.getStatus())) {
                        throw new ConflictException(REFUND_STATE_CHANGED + ": only a pending bank or UPI refund "
                                + "takes a payout");
                    }
                    if (paidOn.isBefore(today)) {
                        periodGuard.ifAvailable(guard -> guard.assertOpen(instituteId, paidOn));
                    }
                    if (!markProcessedInside(order, refund, new Facts(actor, reference, paidOn, null))) {
                        throw new ConflictException(REFUND_STATE_CHANGED + ": the refund changed meanwhile");
                    }
                    auditService.record(instituteId, actor, order.getFulfilmentLocationId(), "REFUND_PAYOUT_RECORDED",
                            "REFUND", refund.getId(), null, CommerceInputRules.json(Map.of("reference", reference,
                                    "paid_on", paidOn.toString())), null);
                    return refund.getId();
                }, seen::getId);
        return view(instituteId, outcome.value(), outcome.replayed());
    }

    /** {@code POST /refunds/{id}/cancel}: a pending refund (manual, or a gateway one not yet sent) is dropped. */
    public RefundDtos.RefundView cancel(CustomUserDetails user, String instituteId, String refundId,
                                        RefundDtos.CancelRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        String reason = text(request.getReason(), "reason", 500);
        if (reason == null) {
            throw validation("reason is required");
        }
        CommerceRefund seen = authorizeOn(user, instituteId, refundId, MANAGER);
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId,
                        key, "REFUND_CANCEL", "REFUND", seen.getId(),
                        CommerceRequestGuard.hash("REFUND_CANCEL", request, seen.getId()), actor),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, seen.getOrderId());
                    CommerceRefund refund = fresh(seen.getId());
                    if (!RefundStatus.PENDING.name().equals(refund.getStatus())) {
                        throw new ConflictException(REFUND_STATE_CHANGED + ": the refund is " + refund.getStatus()
                                + "; only a pending refund is cancelled");
                    }
                    // Only from PENDING: a refund the executor claimed after the read above is being
                    // sent and is never failed from here.
                    if (!markFailedInside(order, refund, CANCELLED, reason, actor, null, true)) {
                        throw new ConflictException(REFUND_STATE_CHANGED + ": the refund changed meanwhile");
                    }
                    auditService.record(instituteId, actor, order.getFulfilmentLocationId(), "REFUND_CANCELLED",
                            "REFUND", refund.getId(), null, null, reason);
                    return refund.getId();
                }, seen::getId);
        return view(instituteId, outcome.value(), outcome.replayed());
    }

    /**
     * {@code POST /refunds/{id}/check}: a gateway refund under way is asked about now. There is no
     * manual "processed" or "failed" for a gateway refund: the gateway's answer decides.
     */
    public RefundDtos.RefundView check(CustomUserDetails user, String instituteId, String refundId,
                                       RefundDtos.CheckRequest request) {
        String key = CommerceRequestGuard.requireClientKey(request == null ? null : request.getClientRequestId());
        CommerceRefund seen = authorizeOn(user, instituteId, refundId, MANAGER);
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId,
                        key, "REFUND_CHECK", "REFUND", seen.getId(),
                        CommerceRequestGuard.hash("REFUND_CHECK", request, seen.getId()), actor),
                () -> {
                    CommerceRefund refund = fresh(seen.getId());
                    if (!RefundMethod.GATEWAY.name().equals(refund.getMethod())
                            || !RefundStatus.IN_PROGRESS.name().equals(refund.getStatus())) {
                        throw new ConflictException(REFUND_STATE_CHANGED + ": only a gateway refund under way is "
                                + "checked");
                    }
                    refundRepository.dueNow(refund.getId(), new Date());
                    auditService.record(instituteId, actor, null, "REFUND_CHECKED", "REFUND", refund.getId(), null,
                            null, null);
                    return refund.getId();
                }, seen::getId);
        CommerceRefundExecutor run = executor.getIfAvailable();
        if (run != null) {
            run.check(outcome.value(), new Date());
        }
        return view(instituteId, outcome.value(), outcome.replayed());
    }

    // ================================================================== ledger (callers hold the order lock)

    /**
     * Writes a refund of the locked order and moves the order's ledger: an ORDER refund raises
     * {@code refund_committed}, and {@code amount_refunded} when it is PROCESSED at once. The
     * caps are the caller's. Saves the order.
     */
    public CommerceRefund insertInside(CommerceOrder order, NewRefund n) {
        Date now = new Date();
        CommerceRefund refund = new CommerceRefund();
        refund.setInstituteId(order.getInstituteId());
        refund.setOrderId(order.getId());
        refund.setReturnId(n.returnId());
        refund.setCreditNoteId(n.creditNoteId());
        refund.setKind(n.kind().name());
        refund.setSource(n.source().name());
        refund.setMethod(n.method().name());
        refund.setStatus(n.status().name());
        refund.setAmount(n.amount());
        refund.setCurrency(order.getCurrency());
        if (n.method() == RefundMethod.GATEWAY) {
            refund.setGatewayVendor(VENDOR);
            refund.setGatewayPaymentId(n.gatewayPaymentId());
            refund.setPaymentLogId(order.getPrimaryPaymentLogId());
            refund.setGatewayRefundId(n.gatewayRefundId());
            refund.setGatewayStatus(n.gatewayStatus());
            if (n.status() == RefundStatus.PENDING) {
                refund.setNextPollAt(now);
            } else if (n.status() == RefundStatus.IN_PROGRESS) {
                refund.setClaimedAt(now);
                refund.setNextPollAt(new Date(now.getTime() + GATEWAY_RECHECK_MILLIS));
            }
        }
        refund.setReference(n.reference());
        refund.setAppliedOrderId(n.appliedOrderId());
        refund.setPaidOn(n.paidOn());
        refund.setReason(n.reason());
        refund.setIdempotencyKey(n.idempotencyKey());
        refund.setCreatedBy(n.actor());
        if (n.status() == RefundStatus.PROCESSED) {
            refund.setProcessedAt(now);
            refund.setProcessedBy(n.actor());
        }
        refund = refundRepository.saveAndFlush(refund);
        if (n.kind() == RefundKind.ORDER) {
            order.setRefundCommitted(nz(order.getRefundCommitted()).add(n.amount()));
            if (n.status() == RefundStatus.PROCESSED) {
                order.setAmountRefunded(nz(order.getAmountRefunded()).add(n.amount()));
            }
            orderRepository.save(order);
        }
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("method", n.method().name());
        detail.put("amount", n.amount().toPlainString());
        detail.put("status", n.status().name());
        detail.put("source", n.source().name());
        detail.put("return_id", n.returnId());
        auditService.record(order.getInstituteId(), n.actor(), order.getFulfilmentLocationId(), "REFUND_CREATED",
                "REFUND", refund.getId(), null, CommerceInputRules.json(detail), n.reason());
        if (n.status() == RefundStatus.PROCESSED) {
            afterProcessed(order, refund);
        }
        return refund;
    }

    /**
     * PENDING or IN_PROGRESS to PROCESSED, in a transaction (joined or new): the order is locked
     * first. False when another caller got there first (a replay changes nothing).
     */
    public boolean markProcessed(String refundId, Facts facts) {
        Boolean done = transaction.execute(status -> {
            CommerceRefund refund = refundRepository.findById(refundId).orElse(null);
            if (refund == null) {
                return false;
            }
            CommerceOrder order = desk.lockOrder(refund.getInstituteId(), refund.getOrderId());
            return markProcessedInside(order, fresh(refundId), facts);
        });
        return Boolean.TRUE.equals(done);
    }

    /** PENDING or IN_PROGRESS to FAILED, in a transaction (joined or new); the order is locked first. */
    public boolean markFailed(String refundId, String code, String reason) {
        Boolean done = transaction.execute(status -> {
            CommerceRefund refund = refundRepository.findById(refundId).orElse(null);
            if (refund == null) {
                return false;
            }
            CommerceOrder order = desk.lockOrder(refund.getInstituteId(), refund.getOrderId());
            return markFailedInside(order, fresh(refundId), code, reason, null, null);
        });
        return Boolean.TRUE.equals(done);
    }

    /** As {@link #markFailed(String, String, String)} with the gateway's status word. */
    public boolean markFailed(String refundId, String code, String reason, String gatewayStatus) {
        Boolean done = transaction.execute(status -> {
            CommerceRefund refund = refundRepository.findById(refundId).orElse(null);
            if (refund == null) {
                return false;
            }
            CommerceOrder order = desk.lockOrder(refund.getInstituteId(), refund.getOrderId());
            return markFailedInside(order, fresh(refundId), code, reason, null, gatewayStatus);
        });
        return Boolean.TRUE.equals(done);
    }

    boolean markProcessedInside(CommerceOrder order, CommerceRefund refund, Facts facts) {
        Facts f = facts == null ? new Facts(null, null, null, null) : facts;
        if (refundRepository.markProcessed(refund.getId(), new Date(), f.actor(), clip(f.reference(), 100),
                f.paidOn(), clip(f.gatewayStatus(), 32)) != 1) {
            return false;
        }
        refresh(refund);
        if (RefundKind.ORDER.name().equals(refund.getKind())) {
            order.setAmountRefunded(nz(order.getAmountRefunded()).add(refund.getAmount()));
            orderRepository.save(order);
        }
        afterProcessed(order, refund);
        return true;
    }

    boolean markFailedInside(CommerceOrder order, CommerceRefund refund, String code, String reason, String actor,
                             String gatewayStatus) {
        return markFailedInside(order, refund, code, reason, actor, gatewayStatus, false);
    }

    /** As above; {@code pendingOnly} (a staff cancel) moves only a refund nobody has claimed. */
    boolean markFailedInside(CommerceOrder order, CommerceRefund refund, String code, String reason, String actor,
                             String gatewayStatus, boolean pendingOnly) {
        Date now = new Date();
        int moved = pendingOnly
                ? refundRepository.cancelPending(refund.getId(), now, clip(code, 64), clip(reason, 500), actor)
                : refundRepository.markFailed(refund.getId(), now, clip(code, 64), clip(reason, 500), actor,
                        clip(gatewayStatus, 32));
        if (moved != 1) {
            return false;
        }
        refresh(refund);
        if (RefundKind.ORDER.name().equals(refund.getKind())) {
            order.setRefundCommitted(nz(order.getRefundCommitted()).subtract(refund.getAmount()));
            orderRepository.save(order);
        }
        if (CANCELLED.equals(code)) {
            log.info("Commerce refund {} of order {} cancelled by staff", refund.getId(), order.getOrderNumber());
        } else {
            log.error("COMMERCE_ALERT refund_failed institute={} order={} refund={} method={} amount={} code={} "
                            + "reason={}", order.getInstituteId(), order.getId(), refund.getId(), refund.getMethod(),
                    refund.getAmount(), code, reason);
        }
        return true;
    }

    /** A refund was paid out: returns close, exception rows resolve, the books and the buyer hear of it. */
    private void afterProcessed(CommerceOrder order, CommerceRefund refund) {
        Date now = new Date();
        dueService.closeReady(order);
        exceptions.resolveByRefund(refund.getId(), "Refunded by refund " + refund.getId(), now);
        if (nz(order.getRefundDue()).compareTo(nz(order.getRefundCommitted())) == 0
                && nz(order.getAmountRefunded()).compareTo(nz(order.getRefundDue())) == 0) {
            exceptions.resolveRefundDue(order.getId(), now);
            exceptions.resolveOversoldRefundedOtherwise(order.getId(), "Refunded by refund " + refund.getId(), now);
        }
        String instituteId = order.getInstituteId();
        String orderId = order.getId();
        String refundId = refund.getId();
        String method = refund.getMethod();
        BigDecimal amount = refund.getAmount();
        desk.afterCommitMoney(hook -> hook.refundProcessed(instituteId, orderId, refundId, method, amount));
        events.afterCommit(desk.event(CommerceOrderEvents.REFUND_PROCESSED, order, null, true));
    }

    // ================================================================== automatic refunds

    /**
     * An order paid after its stock was gone (it was cancelled): all it paid is due back and
     * refunded through the gateway, by the poll job. Own transaction, order locked. Returns the
     * refund id, or null when there is no paying payment to refund. Idempotent by key.
     */
    public String autoOversold(String instituteId, String orderId) {
        if (!accessGuard.featureOn(instituteId, CommerceFeature.ORDERS)) {
            log.error("COMMERCE_ALERT oversold_paid_order_needs_refund institute={} order={} (commerce is off for "
                    + "the institute: no automatic refund)", instituteId, orderId);
            return null;
        }
        return transaction.execute(status -> {
            CommerceOrder order = desk.lockOrder(instituteId, orderId);
            desk.raiseRefundDue(order, nz(order.getAmountPaid()).subtract(nz(order.getRefundDue())),
                    "OVERSOLD:" + orderId, "Paid after the hold ended and the stock was gone.");
            orderRepository.save(order);
            String key = "AUTO:OVERSOLD:" + orderId;
            Optional<CommerceRefund> earlier = refundRepository.findByInstituteIdAndIdempotencyKey(instituteId, key);
            if (earlier.isPresent()) {
                exceptions.linkRefund(orderId, CommercePaymentException.KIND_OVERSOLD_PAID, "", earlier.get().getId());
                return earlier.get().getId();
            }
            // Read as a value: the gateway row may sit in this request's persistence context with
            // the values it had before the payment claim marked it paying (open-in-view).
            String paymentId = gatewayOrders.findPayingPaymentId(orderId).filter(StringUtils::hasText).orElse(null);
            if (paymentId == null) {
                log.error("COMMERCE_ALERT oversold_paid_order_needs_refund institute={} order={} (no paying gateway "
                        + "payment known yet: the refund poll retries)", instituteId, orderId);
                return null;
            }
            BigDecimal open = nz(order.getRefundDue()).subtract(nz(order.getRefundCommitted()));
            if (open.signum() <= 0) {
                // Staff refunded it another way before the automatic refund was made. Settled in
                // full: the exception row is resolved. A refund still pending keeps the row open;
                // the poll does not read it while nothing is open, and reads it again if that
                // refund fails.
                boolean settled = nz(order.getAmountRefunded()).compareTo(nz(order.getRefundDue())) >= 0;
                if (settled) {
                    exceptions.resolveOversoldRefundedOtherwise(orderId, "Refunded otherwise: nothing left due",
                            new Date());
                }
                log.info("Commerce oversold order {} of institute {}: nothing left due back (refunded otherwise{})",
                        orderId, instituteId, settled ? "" : ", a refund is pending");
                return null;
            }
            CommerceRefund refund = insertInside(order, new NewRefund(RefundKind.ORDER, RefundSource.OVERSOLD_PAID,
                    RefundMethod.GATEWAY, RefundStatus.PENDING, open, null, null, paymentId, null,
                    null, null, null, null, "Paid after the stock was gone; the order is cancelled.", key, null));
            exceptions.linkRefund(orderId, CommercePaymentException.KIND_OVERSOLD_PAID, "", refund.getId());
            return refund.getId();
        });
    }

    /**
     * A second captured payment for an order already paid: that payment is given back in full
     * (kind EXTRA_PAYMENT, outside the order's ledger). Own transaction, order locked.
     */
    public String autoDuplicate(String instituteId, String orderId, String gatewayPaymentId, BigDecimal amount) {
        if (!StringUtils.hasText(gatewayPaymentId) || amount == null || amount.signum() <= 0) {
            return null;
        }
        if (!accessGuard.featureOn(instituteId, CommerceFeature.ORDERS)) {
            log.error("COMMERCE_ALERT duplicate_payment_needs_refund institute={} order={} payment={} (commerce is "
                    + "off for the institute: no automatic refund)", instituteId, orderId, gatewayPaymentId);
            return null;
        }
        return transaction.execute(status -> {
            CommerceOrder order = desk.lockOrder(instituteId, orderId);
            String key = "AUTO:DUP:" + gatewayPaymentId;
            Optional<CommerceRefund> earlier = refundRepository.findByInstituteIdAndIdempotencyKey(instituteId, key);
            if (earlier.isPresent()) {
                exceptions.linkRefund(orderId, CommercePaymentException.KIND_DUPLICATE_PAYMENT, gatewayPaymentId,
                        earlier.get().getId());
                return earlier.get().getId();
            }
            CommerceRefund refund = insertInside(order, new NewRefund(RefundKind.EXTRA_PAYMENT,
                    RefundSource.DUPLICATE_PAYMENT, RefundMethod.GATEWAY, RefundStatus.PENDING,
                    amount.setScale(2, java.math.RoundingMode.HALF_UP), null, null, gatewayPaymentId, null, null, null,
                    null, null, "A second payment for an order that was already paid.", key, null));
            exceptions.linkRefund(orderId, CommercePaymentException.KIND_DUPLICATE_PAYMENT, gatewayPaymentId,
                    refund.getId());
            return refund.getId();
        });
    }

    /** A gateway refund still waiting for its call is sent now (the claim makes a second call impossible). */
    public void executeIfPending(String refundId) {
        if (refundId == null) {
            return;
        }
        CommerceRefund refund = ownTransaction.execute(status -> refundRepository.findById(refundId).orElse(null));
        if (refund == null || !RefundMethod.GATEWAY.name().equals(refund.getMethod())
                || !RefundStatus.PENDING.name().equals(refund.getStatus())) {
            return;
        }
        CommerceRefundExecutor run = executor.getIfAvailable();
        if (run != null) {
            try {
                run.execute(refundId);
            } catch (RuntimeException e) {
                // The request answers the refund as it is; the poll job finishes it.
                log.error("COMMERCE_ALERT refund_execute_failed refund={}: {}", refundId, e.getClass().getSimpleName(),
                        e);
            }
        }
    }

    /**
     * The refund row as stored now (read again when the persistence context holds it). Null
     * when there is none. Call inside a transaction.
     */
    public CommerceRefund reload(String refundId) {
        CommerceRefund refund = refundRepository.findById(refundId).orElse(null);
        if (refund != null) {
            refresh(refund);
        }
        return refund;
    }

    /**
     * A gateway outcome (a webhook, the poll, the create's answer) that moved nothing because the
     * row is final already. When our final state says the opposite (FAILED while the gateway
     * says processed or pending, PROCESSED while it says failed) money and the ledger disagree:
     * an alert, so staff check before anything is refunded again. True when it is such a case.
     */
    public boolean outcomeConflict(String refundId, String gatewayStatus, String gatewayRefundId, String source) {
        CommerceRefund refund = ownTransaction.execute(status -> reload(refundId));
        if (refund == null || gatewayStatus == null) {
            return false;
        }
        String gateway = gatewayStatus.trim().toLowerCase(Locale.ROOT);
        boolean conflict = (RefundStatus.FAILED.name().equals(refund.getStatus())
                && ("processed".equals(gateway) || "pending".equals(gateway) || "created".equals(gateway)))
                || (RefundStatus.PROCESSED.name().equals(refund.getStatus()) && "failed".equals(gateway));
        if (conflict) {
            log.error("COMMERCE_ALERT refund_outcome_conflict institute={} order={} refund={} ours={} gateway={} "
                            + "gateway_refund={} source={} (the gateway's outcome contradicts the recorded one: check "
                            + "the payment before any further refund)", refund.getInstituteId(), refund.getOrderId(),
                    refund.getId(), refund.getStatus(), gateway, gatewayRefundId, source);
        }
        return conflict;
    }

    // ================================================================== reads

    public RefundDtos.RefundView get(CustomUserDetails user, String instituteId, String refundId) {
        CommerceRefund refund = authorizeOn(user, instituteId, refundId, READERS);
        return view(instituteId, refund.getId(), false);
    }

    public RefundDtos.RefundPage list(CustomUserDetails user, String instituteId, String status, String method,
                                      String orderId, LocalDate from, LocalDate to, int page, int pageSize) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, READERS);
        String s = status == null || status.isBlank() ? null : status.trim().toUpperCase(Locale.ROOT);
        if (s != null && RefundStatus.of(s) == null) {
            throw validation("status is PENDING, IN_PROGRESS, PROCESSED or FAILED");
        }
        String m = method == null || method.isBlank() ? null : method.trim().toUpperCase(Locale.ROOT);
        if (m != null && RefundMethod.of(m) == null) {
            throw validation("method is GATEWAY, BANK_TRANSFER, UPI, CASH or EXCHANGE_CREDIT");
        }
        if (from != null && to != null && to.isBefore(from)) {
            throw validation("to is before from");
        }
        int size = Math.min(Math.max(pageSize, 1), 50);
        int index = Math.max(page, 0);
        Date fromTime = from == null ? null : Date.from(from.atStartOfDay(INDIA).toInstant());
        Date toTime = to == null ? null : Date.from(to.plusDays(1).atStartOfDay(INDIA).toInstant());
        String o = orderId == null || orderId.isBlank() ? null : orderId.trim();
        return ownTransaction.execute(tx -> {
            Page<CommerceRefund> found = refundRepository.search(instituteId, s, m, o, fromTime, toTime,
                    PageRequest.of(index, size));
            return RefundDtos.RefundPage.builder().refunds(summaries(found.getContent())).page(index).pageSize(size)
                    .total(found.getTotalElements()).build();
        });
    }

    /** The refund as it is now, read in a transaction of its own. */
    public RefundDtos.RefundView view(String instituteId, String refundId, boolean replayed) {
        return ownTransaction.execute(tx -> {
            CommerceRefund r = refundRepository.findByIdAndInstituteId(refundId, instituteId)
                    .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "REFUND_NOT_FOUND: no such refund"));
            // The request's persistence context may hold the row as it was before the executor's
            // native updates (claim, gateway id): read it again.
            refresh(r);
            String orderNumber = orderRepository.findById(r.getOrderId()).map(CommerceOrder::getOrderNumber)
                    .orElse(null);
            String returnNumber = r.getReturnId() == null ? null : returnRepository.findById(r.getReturnId())
                    .map(CommerceReturn::getReturnNumber).orElse(null);
            return RefundDtos.RefundView.builder()
                    .id(r.getId()).orderId(r.getOrderId()).orderNumber(orderNumber).returnId(r.getReturnId())
                    .returnNumber(returnNumber).kind(r.getKind()).source(r.getSource()).method(r.getMethod())
                    .amount(r.getAmount()).currency(r.getCurrency()).status(r.getStatus()).reference(r.getReference())
                    .gatewayRefundId(r.getGatewayRefundId()).gatewayStatus(r.getGatewayStatus())
                    .appliedOrderId(r.getAppliedOrderId())
                    .paidOn(r.getPaidOn() == null ? null : r.getPaidOn().toString()).reason(r.getReason())
                    .failureCode(r.getFailureCode()).failureReason(r.getFailureReason()).createdBy(r.getCreatedBy())
                    .createdAt(instant(r.getCreatedAt())).processedAt(instant(r.getProcessedAt()))
                    .failedAt(instant(r.getFailedAt())).replayed(replayed ? Boolean.TRUE : null)
                    .build();
        });
    }

    /** Summaries of refunds (call inside a transaction). */
    public List<RefundDtos.RefundSummary> summaries(List<CommerceRefund> refunds) {
        Map<String, String> orderNumbers = new HashMap<>();
        Map<String, String> returnNumbers = new HashMap<>();
        List<RefundDtos.RefundSummary> out = new ArrayList<>();
        for (CommerceRefund r : refunds) {
            String orderNumber = orderNumbers.computeIfAbsent(r.getOrderId(), id -> orderRepository.findById(id)
                    .map(CommerceOrder::getOrderNumber).orElse(null));
            String returnNumber = r.getReturnId() == null ? null : returnNumbers.computeIfAbsent(r.getReturnId(),
                    id -> returnRepository.findById(id).map(CommerceReturn::getReturnNumber).orElse(null));
            out.add(RefundDtos.RefundSummary.builder()
                    .id(r.getId()).orderId(r.getOrderId()).orderNumber(orderNumber).returnId(r.getReturnId())
                    .returnNumber(returnNumber).kind(r.getKind()).source(r.getSource()).method(r.getMethod())
                    .amount(r.getAmount()).currency(r.getCurrency()).status(r.getStatus()).reference(r.getReference())
                    .gatewayRefundId(r.getGatewayRefundId()).gatewayStatus(r.getGatewayStatus())
                    .appliedOrderId(r.getAppliedOrderId())
                    .paidOn(r.getPaidOn() == null ? null : r.getPaidOn().toString())
                    .failureCode(r.getFailureCode()).createdBy(r.getCreatedBy()).createdAt(instant(r.getCreatedAt()))
                    .processedAt(instant(r.getProcessedAt())).failedAt(instant(r.getFailedAt()))
                    .build());
        }
        return out;
    }

    // ================================================================== helpers

    /** The refund caps of the order ledger: the open due and what was paid. */
    public static void requireWithinDue(CommerceOrder order, BigDecimal amount) {
        BigDecimal committed = nz(order.getRefundCommitted());
        BigDecimal open = nz(order.getRefundDue()).subtract(committed);
        if (amount.compareTo(open) > 0) {
            throw new ConflictException(REFUND_ABOVE_DUE + ": " + open.max(BigDecimal.ZERO).toPlainString()
                    + " is due back on this order and not yet refunded");
        }
        BigDecimal paidLeft = nz(order.getAmountPaid()).subtract(committed);
        if (amount.compareTo(paidLeft) > 0) {
            throw new ConflictException(REFUND_ABOVE_PAID + ": only " + paidLeft.max(BigDecimal.ZERO).toPlainString()
                    + " of what was paid is left to refund");
        }
    }

    /** The gateway order row that paid the order; 409 when there is none or it names no payment. */
    public CommerceGatewayOrder payingRow(String orderId) {
        CommerceGatewayOrder paying = gatewayOrders.findFirstByCommerceOrderIdAndPayingTrue(orderId).orElse(null);
        if (paying == null) {
            throw new ConflictException(REFUND_METHOD_NOT_AVAILABLE + ": the order was not paid through the gateway");
        }
        // A managed row may predate the bulk update that marked it paying in this request.
        refresh(paying);
        if (!StringUtils.hasText(paying.getGatewayPaymentId())) {
            throw new ConflictException(GATEWAY_PAYMENT_UNKNOWN + ": the gateway payment of the order is not known");
        }
        return paying;
    }

    private CommercePaymentGateway.GatewayRefund readAdopted(String instituteId, CommerceOrder order, Clean clean) {
        CommerceGatewayOrder paying = ownTransaction.execute(status -> payingRow(order.getId()));
        CommercePaymentGateway.GatewayRefund found;
        try {
            found = gateway.fetchRefund(instituteId, paying.getGatewayPaymentId(), clean.gatewayRefundId());
        } catch (CommercePaymentGatewayException e) {
            throw new ConflictException(GATEWAY_REFUND_MISMATCH + ": the gateway refund could not be read ("
                    + e.getCode() + ")");
        }
        if (found == null || !paying.getGatewayPaymentId().equals(found.paymentId())) {
            throw new ConflictException(GATEWAY_REFUND_MISMATCH + ": the gateway refund is not on this order's "
                    + "payment");
        }
        if (found.amountMinor() != toMinor(clean.amount(), order.getCurrency())) {
            throw new ConflictException(GATEWAY_REFUND_MISMATCH + ": the gateway refund is for another amount");
        }
        if (!"processed".equals(found.status()) && !"pending".equals(found.status())) {
            throw new ConflictException(GATEWAY_REFUND_MISMATCH + ": the gateway refund is " + found.status());
        }
        String receipt = found.receipt();
        if (StringUtils.hasText(receipt) && receipt.length() <= 36 && Boolean.TRUE.equals(ownTransaction.execute(
                status -> refundRepository.findById(receipt.trim()).isPresent()))) {
            // Its receipt names one of our refunds: the shop sent it, and that row records it
            // (the poll or the webhook stores its id). Adopting it would count it twice.
            throw new ConflictException(GATEWAY_REFUND_MISMATCH + ": the gateway refund is the shop's own refund "
                    + receipt.trim() + "; it is recorded there");
        }
        return found;
    }

    private CommerceRefund authorizeOn(CustomUserDetails user, String instituteId, String refundId,
                                       Set<CommerceRole> roles) {
        CommerceRefund refund = ownTransaction.execute(status -> StringUtils.hasText(refundId)
                ? refundRepository.findByIdAndInstituteId(refundId.trim(), instituteId).orElse(null) : null);
        if (refund == null) {
            // The feature and membership come first: an outsider learns nothing about ids.
            accessGuard.require(user, instituteId, CommerceFeature.ORDERS, roles);
            throw new VacademyException(HttpStatus.NOT_FOUND, "REFUND_NOT_FOUND: no such refund");
        }
        String location = null;
        if (refund.getReturnId() != null) {
            location = ownTransaction.execute(status -> returnRepository.findById(refund.getReturnId())
                    .map(CommerceReturn::getLocationId).orElse(null));
        }
        if (location == null) {
            location = desk.readOrder(instituteId, refund.getOrderId()).getFulfilmentLocationId();
        }
        desk.authorize(user, instituteId, location, roles);
        return refund;
    }

    private CommerceReturn readReturn(String instituteId, String returnId) {
        CommerceReturn ret = ownTransaction.execute(status -> returnRepository.findByIdAndInstituteId(returnId,
                instituteId).orElse(null));
        if (ret == null) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "RETURN_NOT_FOUND: no such return");
        }
        return ret;
    }

    /** A return of the institute locked FOR UPDATE and read again (after its order's lock). */
    public CommerceReturn lockReturn(String instituteId, String returnId) {
        CommerceReturn ret = returnRepository.lockById(returnId).orElse(null);
        if (ret != null && entityManager != null) {
            entityManager.refresh(ret);
        }
        if (ret == null || !instituteId.equals(ret.getInstituteId())) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "RETURN_NOT_FOUND: no such return");
        }
        return ret;
    }

    private CommerceRefund fresh(String refundId) {
        CommerceRefund refund = refundRepository.findById(refundId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "REFUND_NOT_FOUND: no such refund"));
        refresh(refund);
        return refund;
    }

    private void refresh(Object entity) {
        if (entityManager != null && entityManager.contains(entity)) {
            entityManager.refresh(entity);
        }
    }

    Clean validate(RefundDtos.CreateRefundRequest request, LocalDate today) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        String orderId = text(request.getOrderId(), "order_id", 36);
        if (orderId == null) {
            throw validation("order_id is required");
        }
        String returnId = text(request.getReturnId(), "return_id", 36);
        BigDecimal amount = request.getAmount();
        if (amount == null || amount.signum() <= 0 || amount.stripTrailingZeros().scale() > 2
                || amount.compareTo(MAX_AMOUNT) > 0) {
            throw validation("amount is above zero with at most two decimals");
        }
        String rawMethod = request.getMethod() == null ? null : request.getMethod().trim().toUpperCase(Locale.ROOT);
        RefundMethod method = RefundMethod.of(rawMethod);
        if (method == RefundMethod.EXCHANGE_CREDIT) {
            throw new ConflictException(USE_EXCHANGE_ORDER + ": an exchange is made from a new order with the return");
        }
        if (method == null) {
            throw validation("method is GATEWAY, BANK_TRANSFER, UPI or CASH");
        }
        String reference = text(request.getReference(), "reference", 100);
        LocalDate paidOn = request.getPaidOn() == null || request.getPaidOn().isBlank() ? null
                : day(request.getPaidOn(), today);
        String reason = text(request.getReason(), "reason", 500);
        if (reason == null) {
            throw validation("reason is required");
        }
        String gatewayRefundId = text(request.getGatewayRefundId(), "gateway_refund_id", 64);
        if (gatewayRefundId != null && method != RefundMethod.GATEWAY) {
            throw validation("gateway_refund_id is named only for a GATEWAY refund");
        }
        return new Clean(key, orderId, returnId, amount.setScale(2, java.math.RoundingMode.UNNECESSARY), method,
                reference, paidOn, reason, gatewayRefundId);
    }

    /** A day {@code yyyy-mm-dd} not after today; today when blank. */
    static LocalDate day(String raw, LocalDate today) {
        if (raw == null || raw.isBlank()) {
            return today;
        }
        LocalDate day;
        try {
            day = LocalDate.parse(raw.trim());
        } catch (DateTimeParseException e) {
            throw validation("paid_on is a date yyyy-mm-dd");
        }
        if (day.isAfter(today)) {
            throw validation("paid_on is not after today");
        }
        return day;
    }

    /** An amount in the minor unit of the currency (paise), exact. */
    public static long toMinor(BigDecimal amount, String currency) {
        int exponent;
        try {
            exponent = CurrencyRegistry.minorUnitExponent(currency);
        } catch (RuntimeException e) {
            exponent = 2;
        }
        return amount.movePointRight(exponent).setScale(0, java.math.RoundingMode.HALF_UP).longValueExact();
    }

    static String text(String raw, String field, int max) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.trim();
        if (value.length() > max) {
            throw validation(field + " is at most " + max + " characters");
        }
        return value;
    }

    static String clip(String value, int max) {
        return value == null || value.length() <= max ? value : value.substring(0, max);
    }

    static InvalidRequestException validation(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }

    static BigDecimal nz(BigDecimal value) {
        return value == null ? BigDecimal.ZERO.setScale(2) : value;
    }

    static String instant(LocalDateTime value) {
        return value == null ? null : value.toInstant(ZoneOffset.UTC).toString();
    }

    static String instant(Date value) {
        return value == null ? null : value.toInstant().toString();
    }
}
