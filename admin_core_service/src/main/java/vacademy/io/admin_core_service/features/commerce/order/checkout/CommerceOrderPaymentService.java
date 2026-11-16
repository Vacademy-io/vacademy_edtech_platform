package vacademy.io.admin_core_service.features.commerce.order.checkout;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository.HoldRow;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository.LogRow;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderTransitions;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * What happens to an order when its money arrives and when its payment window closes.
 *
 * <p><b>Confirm</b> ({@link #onPaymentLogPaid}, {@link #ensurePaidOrderConfirmed}) is safe to
 * call any number of times, from the webhook, the verify call and the reconcile job. It runs
 * in three steps and holds the order lock only in the last:
 * <ol>
 *   <li>read: every payment log of the order's group is PAID, their sum is the order total and
 *       the gateway order is the one the order stored; anything else is refused and alerted;</li>
 *   <li>each plan becomes ACTIVE and its stock hold settles through
 *       {@code StockHoldService.onPlanActivated(plan, null)}: HELD becomes SOLD with no second
 *       decrement, a hold the expiry job released is taken again, or marked oversold when the
 *       stock is gone. That method is idempotent per plan. Called with no transaction open
 *       (the payment path) these are short transactions one after the other, so the thread
 *       never holds two database connections at once;</li>
 *   <li>under the order row lock: the holds are read back. All sold: the order is CONFIRMED
 *       and the tender RECEIVED. Any oversold: the order is (or stays) CANCELLED with reason
 *       OVERSOLD_PAID, the stock of its other lines goes back on sale and a refund is due.
 *       A hold that is still not settled leaves the order as it is for the next delivery or
 *       the reconcile job.</li>
 * </ol>
 *
 * <p><b>Expire</b> ({@link #onHoldExpired}) cancels an unpaid order: remaining holds are
 * released, plans waiting for the payment become CANCELED, the pending tender is VOID and the
 * coupon use the order took is given back. The payment logs stay PAYMENT_PENDING, so a payment
 * that still arrives is claimed and comes back here as a late payment.
 *
 * <p><b>Payable</b> ({@link #ensurePayable}): the payment step is handed out only while the
 * stock of the order is still held. An order whose hold time is over, or whose holds were
 * released, is cancelled there and then instead of being offered for payment.
 *
 * <p>No remote call is made here at all, and no step joins a caller's transaction.
 */
@Slf4j
@Service
public class CommerceOrderPaymentService {

    public static final String REASON_PAYMENT_EXPIRED = "PAYMENT_EXPIRED";
    public static final String REASON_SHOPPER_RELEASED = "SHOPPER_RELEASED";
    public static final String REASON_OVERSOLD_PAID = "OVERSOLD_PAID";
    static final String NOTE_LATE_PAYMENT = "LATE_PAYMENT";
    private static final String PAID = "PAID";
    private static final String ACTIVE = "ACTIVE";
    private static final String HELD = "HELD";
    private static final String RELEASED = "RELEASED";
    private static final String SOLD = "SOLD";

    /** How a confirm call ended. Only CONFIRMED and OVERSOLD_PAID changed the order. */
    public enum Outcome {
        CONFIRMED,
        OVERSOLD_PAID,
        ALREADY_SETTLED,
        NOT_PAID_YET,
        /** Some payment logs of the order are PAID and some are not: a person must look. */
        PARTLY_PAID,
        REFUSED_MISMATCH,
        STOCK_NOT_SETTLED,
        NOT_A_COMMERCE_ORDER
    }

    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceOrderLegacyRepository legacyRepository;
    private final CommerceOrderWriter writer;
    private final StockHoldService stockHoldService;
    private final UserPlanService userPlanService;
    private final CommerceRefundHook refundHook;
    /**
     * Every step runs in a transaction of its own (REQUIRES_NEW, never read-only, so it reads
     * the primary). The callers are the webhook's after-commit hook, the hold-release hook and
     * jobs: in an after-commit callback the finished transaction is still bound to the thread,
     * and work that joined it would never be committed.
     */
    private final TransactionTemplate ownTransaction;

    /** Only to read a locked order again; absent in tests that build this class by hand. */
    @PersistenceContext
    private EntityManager entityManager;

    /**
     * The order row, locked, with the state the database has now. A web request keeps one
     * persistence context for all its transactions, so the order an earlier step of the same
     * call has read is still in it, and a locking query hands that same object back without
     * reading it again. A decision made under the lock on what the object said before the lock
     * would be made on old state: an order another thread cancelled or confirmed a moment ago
     * would be settled a second time. So it is refreshed after the lock is taken.
     */
    private CommerceOrder lockFresh(String orderId) {
        CommerceOrder order = orderRepository.lockById(orderId).orElse(null);
        if (order != null && entityManager != null) {
            entityManager.refresh(order);
        }
        return order;
    }

    public CommerceOrderPaymentService(CommerceOrderRepository orderRepository,
                                       CommerceOrderLineRepository lineRepository,
                                       CommerceOrderTenderRepository tenderRepository,
                                       CommerceOrderLegacyRepository legacyRepository,
                                       CommerceOrderWriter writer,
                                       StockHoldService stockHoldService,
                                       UserPlanService userPlanService,
                                       CommerceRefundHook refundHook,
                                       PlatformTransactionManager transactionManager) {
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.tenderRepository = tenderRepository;
        this.legacyRepository = legacyRepository;
        this.writer = writer;
        this.stockHoldService = stockHoldService;
        this.userPlanService = userPlanService;
        this.refundHook = refundHook;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    // ------------------------------------------------------------------ paid

    /** A payment log reads PAID. Idempotent; a log that belongs to no shop order is ignored. */
    public Outcome onPaymentLogPaid(String paymentLogId) {
        return onPaymentLogPaid(paymentLogId, null, null);
    }

    /**
     * As {@link #onPaymentLogPaid(String)}, with what the gateway reported: its order id and the
     * captured amount in minor units. Either may be null (not known to the caller); a value
     * that is given must match the order, or nothing is confirmed.
     */
    public Outcome onPaymentLogPaid(String paymentLogId, String gatewayOrderId, Long amountMinor) {
        if (!StringUtils.hasText(paymentLogId)) {
            return Outcome.NOT_A_COMMERCE_ORDER;
        }
        String orderId = ownTransaction.execute(status -> {
            String groupId = legacyRepository.findGroupIdOfLog(paymentLogId);
            if (!StringUtils.hasText(groupId)) {
                return null;
            }
            return orderRepository.findByPaymentGroupId(groupId).map(CommerceOrder::getId).orElse(null);
        });
        if (orderId == null) {
            return Outcome.NOT_A_COMMERCE_ORDER;
        }
        return confirmOrRetryAfterCommit(orderId, gatewayOrderId, amountMinor);
    }

    /** Confirms a paid order whose confirm step did not run or did not finish. Idempotent. */
    public Outcome ensurePaidOrderConfirmed(String commerceOrderId) {
        if (!StringUtils.hasText(commerceOrderId)) {
            return Outcome.NOT_A_COMMERCE_ORDER;
        }
        return confirmOrRetryAfterCommit(commerceOrderId, null, null);
    }

    /**
     * A caller that is still inside the transaction that marks the logs PAID is too early: its
     * own transaction is not visible yet. The confirm step then runs once more when that
     * transaction has committed. (Registered from inside an after-commit callback the retry
     * never fires, which is right: there the answer NOT_PAID_YET is the real one.)
     */
    private Outcome confirmOrRetryAfterCommit(String orderId, String gatewayOrderId, Long amountMinor) {
        Outcome outcome = confirm(orderId, gatewayOrderId, amountMinor);
        if (outcome == Outcome.NOT_PAID_YET && TransactionSynchronizationManager.isSynchronizationActive()
                && TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        confirm(orderId, gatewayOrderId, amountMinor);
                    } catch (RuntimeException e) {
                        // The reconcile job picks the order up.
                        log.error("COMMERCE_ALERT paid_order_confirm_failed order={}", orderId, e);
                    }
                }
            });
        }
        return outcome;
    }

    private Outcome confirm(String orderId, String gatewayOrderId, Long amountMinor) {
        // 1. Read and check; no lock.
        record Checked(Outcome stop, List<String> planIds) {
        }
        Checked checked = ownTransaction.execute(status -> {
            CommerceOrder order = orderRepository.findById(orderId).orElse(null);
            if (order == null) {
                return new Checked(Outcome.NOT_A_COMMERCE_ORDER, List.of());
            }
            if (settled(order)) {
                return new Checked(Outcome.ALREADY_SETTLED, List.of());
            }
            List<LogRow> logs = legacyRepository.findLogsOfGroup(order.getPaymentGroupId());
            long paid = logs.stream().filter(row -> PAID.equals(row.getPaymentStatus())).count();
            if (paid == 0) {
                return new Checked(Outcome.NOT_PAID_YET, List.of());
            }
            if (paid != logs.size()) {
                log.error("COMMERCE_ALERT order_partly_paid institute={} order={} number={} paid_logs={} of {}",
                        order.getInstituteId(), order.getId(), order.getOrderNumber(), paid, logs.size());
                return new Checked(Outcome.PARTLY_PAID, List.of());
            }
            String refusal = mismatch(order, logs, gatewayOrderId, amountMinor);
            if (refusal != null) {
                log.error("COMMERCE_ALERT paid_order_refused institute={} order={} number={} reason={}",
                        order.getInstituteId(), order.getId(), order.getOrderNumber(), refusal);
                return new Checked(Outcome.REFUSED_MISMATCH, List.of());
            }
            return new Checked(null, planIds(lineRepository.findByOrderIdOrderByLineNoAsc(orderId)));
        });
        if (checked.stop() != null) {
            return checked.stop();
        }

        // 2. Plans and stock, before the order lock. Idempotent.
        //
        //    With no transaction on the thread (the webhook, the client call, the reconcile
        //    job) the plan is read in one short transaction and activated outside it: the
        //    stock step of StockHoldService then finds no transaction to wait for and runs at
        //    once in one of its own. The thread holds one connection at a time.
        //
        //    Inside a caller's transaction or an after-commit callback the stock step would be
        //    deferred to that caller's commit and the order could not be settled below, so
        //    there each plan gets a transaction of its own and the stock step runs when that
        //    one commits (a second connection, on a path that is not the payment path).
        boolean callerHasTransaction = TransactionSynchronizationManager.isSynchronizationActive();
        for (String planId : checked.planIds()) {
            if (callerHasTransaction) {
                ownTransaction.executeWithoutResult(status -> activate(userPlanService.findById(planId)));
            } else {
                UserPlan plan = ownTransaction.execute(status -> {
                    UserPlan found = userPlanService.findById(planId);
                    if (found.getEnrollInvite() != null) {
                        found.getEnrollInvite().getInstituteId(); // read while the session is open
                    }
                    return found;
                });
                activate(plan);
            }
        }

        // 3. The order, under its row lock.
        List<Runnable> afterCommit = new ArrayList<>();
        Outcome outcome = ownTransaction.execute(
                status -> settle(orderId, checked.planIds(), gatewayOrderId, afterCommit));
        afterCommit.forEach(Runnable::run);
        return outcome;
    }

    private void activate(UserPlan plan) {
        boolean wasActive = ACTIVE.equals(plan.getStatus());
        userPlanService.activateCommercePlan(plan);
        if (wasActive) {
            // Activated earlier: its stock step may have failed without a trace, so it is run
            // again here.
            stockHoldService.onPlanActivated(plan, null);
        }
    }

    private Outcome settle(String orderId, List<String> planIds, String gatewayOrderId, List<Runnable> afterCommit) {
        CommerceOrder order = lockFresh(orderId);
        if (order == null) {
            return Outcome.NOT_A_COMMERCE_ORDER;
        }
        if (settled(order)) {
            return Outcome.ALREADY_SETTLED;
        }
        CommerceOrderStatus from = CommerceOrderStatus.of(order.getStatus());
        Set<String> oversoldPlans = new LinkedHashSet<>();
        if (!planIds.isEmpty()) {
            for (HoldRow hold : legacyRepository.findHoldsOfPlans(planIds)) {
                if (HELD.equals(hold.getStatus()) || RELEASED.equals(hold.getStatus())) {
                    // The stock step failed or has not run. Nothing is confirmed without its stock.
                    log.error("COMMERCE_ALERT paid_order_stock_not_settled institute={} order={} number={} hold={}",
                            order.getInstituteId(), order.getId(), order.getOrderNumber(), hold.getId());
                    return Outcome.STOCK_NOT_SETTLED;
                }
                if (SOLD.equals(hold.getStatus()) && Boolean.TRUE.equals(hold.getOversold())) {
                    oversoldPlans.add(hold.getUserPlanId());
                }
            }
        }
        Date now = new Date();
        order.setPaymentStatus(CommerceOrderWriter.PAYMENT_PAID);
        order.setAmountPaid(order.getTotal());
        receiveTender(order, now, gatewayOrderId != null ? gatewayOrderId : order.getGatewayOrderId());

        if (oversoldPlans.isEmpty()) {
            CommerceOrderTransitions.require(from, CommerceOrderStatus.CONFIRMED);
            boolean late = from == CommerceOrderStatus.CANCELLED;
            order.setStatus(CommerceOrderStatus.CONFIRMED.name());
            order.setConfirmedAt(now);
            if (late) {
                order.setCancelReason(null);
                order.setCancelledAt(null);
            }
            orderRepository.save(order);
            String note = late ? NOTE_LATE_PAYMENT : "Payment received";
            if (late && StringUtils.hasText(order.getAppliedCouponDiscountId())) {
                // The use was given back when the order was cancelled unpaid: take it again.
                // When someone else has taken it meanwhile the order keeps its discount, and
                // the coupon is over its limit by one.
                if (legacyRepository.takeCouponUseAgain(order.getAppliedCouponDiscountId()) == 0
                        && legacyRepository.couponIsLimited(order.getAppliedCouponDiscountId()) > 0) {
                    note = NOTE_LATE_PAYMENT + "; coupon " + order.getCouponCode() + " is over its limit by one";
                }
            }
            writer.history(order, from, CommerceOrderStatus.CONFIRMED, null, note);
            log.info("Commerce order {} ({}) confirmed{}", order.getOrderNumber(), order.getId(),
                    late ? " on a late payment" : "");
            return Outcome.CONFIRMED;
        }

        // Paid, and at least one line has no stock: the order is not fulfilled. Lines that did
        // get their stock give it back (restoreForPlan pays a sellable deficit first); an
        // oversold line never gives back, because it took nothing.
        if (from != CommerceOrderStatus.CANCELLED) {
            CommerceOrderTransitions.require(from, CommerceOrderStatus.CANCELLED);
            order.setStatus(CommerceOrderStatus.CANCELLED.name());
            order.setCancelledAt(now);
        }
        order.setCancelReason(REASON_OVERSOLD_PAID);
        orderRepository.save(order);
        for (String planId : planIds) {
            if (oversoldPlans.contains(planId)) {
                stockHoldService.closeWithoutGiveBack(planId, null, REASON_OVERSOLD_PAID);
            } else {
                stockHoldService.restoreForPlan(planId, null);
            }
        }
        writer.history(order, from, CommerceOrderStatus.CANCELLED, null,
                REASON_OVERSOLD_PAID + ": paid after the hold ended and the stock was gone; refund due");
        String instituteId = order.getInstituteId();
        String number = order.getOrderNumber();
        BigDecimal amount = order.getTotal();
        String currency = order.getCurrency();
        afterCommit.add(() -> {
            try {
                refundHook.refundOversoldPaidOrder(instituteId, orderId, number, amount, currency);
            } catch (RuntimeException e) {
                log.error("COMMERCE_ALERT oversold_refund_hook_failed order={}", orderId, e);
            }
        });
        return Outcome.OVERSOLD_PAID;
    }

    /** PENDING to RECEIVED; an order cancelled unpaid had its tender voided, so it gets a new one. */
    private void receiveTender(CommerceOrder order, Date now, String reference) {
        if (tenderRepository.settlePending(order.getId(), CommerceOrderTender.STATUS_RECEIVED, now, reference) > 0) {
            return;
        }
        CommerceOrderTender tender = new CommerceOrderTender();
        tender.setInstituteId(order.getInstituteId());
        tender.setOrderId(order.getId());
        tender.setMode(CommerceOrderTender.MODE_GATEWAY);
        tender.setAmount(order.getTotal());
        tender.setStatus(CommerceOrderTender.STATUS_RECEIVED);
        tender.setReceivedAt(now);
        tender.setReference(reference);
        tenderRepository.save(tender);
    }

    /** Null when the money matches the order; else why it does not. Never contains a secret. */
    static String mismatch(CommerceOrder order, List<LogRow> logs, String gatewayOrderId, Long amountMinor) {
        BigDecimal sum = BigDecimal.ZERO;
        for (LogRow row : logs) {
            sum = sum.add(row.getAmount() == null ? BigDecimal.ZERO : row.getAmount());
        }
        if (sum.compareTo(order.getTotal()) != 0) {
            return "log_sum_differs_from_total";
        }
        // The payment code ties a payment to the order by its own gateway-order row and has
        // compared the amount with it; here a gateway order that is named must be the stored one.
        if (gatewayOrderId != null && StringUtils.hasText(order.getGatewayOrderId())
                && !Objects.equals(gatewayOrderId, order.getGatewayOrderId())) {
            return "gateway_order_differs";
        }
        if (amountMinor != null && amountMinor != minor(order.getTotal())) {
            return "captured_amount_differs";
        }
        return null;
    }

    /** Rupees to paise (and the like): every currency the shop sells in has two decimals. */
    public static long minor(BigDecimal amount) {
        return amount.movePointRight(2).setScale(0, java.math.RoundingMode.UNNECESSARY).longValueExact();
    }

    private static boolean settled(CommerceOrder order) {
        if (CommerceOrderWriter.PAYMENT_PAID.equals(order.getPaymentStatus())) {
            return true;
        }
        CommerceOrderStatus status = CommerceOrderStatus.of(order.getStatus());
        return status != CommerceOrderStatus.PENDING_PAYMENT && status != CommerceOrderStatus.CANCELLED;
    }

    private static List<String> planIds(List<CommerceOrderLine> lines) {
        List<String> ids = new ArrayList<>();
        for (CommerceOrderLine line : lines) {
            if (StringUtils.hasText(line.getUserPlanId())) {
                ids.add(line.getUserPlanId());
            }
        }
        return ids;
    }

    // ------------------------------------------------------------------ expired

    /** The payment window of an order closed. Idempotent; a paid order is left alone. */
    public boolean onHoldExpired(String commerceOrderId) {
        return onHoldExpired(commerceOrderId, REASON_PAYMENT_EXPIRED);
    }

    /**
     * Cancels an unpaid order. In a transaction of its own, so that a failure never reaches the
     * caller (the hold-release hook, the sweep) and never shares its fate.
     *
     * @return true when this call cancelled the order
     */
    public boolean onHoldExpired(String commerceOrderId, String reason) {
        if (!StringUtils.hasText(commerceOrderId)) {
            return false;
        }
        Boolean cancelled = ownTransaction.execute(status -> expire(commerceOrderId, reason));
        return Boolean.TRUE.equals(cancelled);
    }

    /**
     * May the payment step of this order be handed out now? Only while the order waits for a
     * payment, its hold time is not over and every hold of it is still HELD. An order that is
     * no longer payable and has no money is cancelled here, under its row lock, so the answer
     * and the state agree: a shopper who released the stock, or whose time ran out, is never
     * offered a payment for stock that may have been sold to someone else.
     *
     * @return true when the order can be paid
     */
    public boolean ensurePayable(String commerceOrderId) {
        if (!StringUtils.hasText(commerceOrderId)) {
            return false;
        }
        Boolean payable = ownTransaction.execute(status -> {
            CommerceOrder order = lockFresh(commerceOrderId);
            if (order == null || CommerceOrderStatus.of(order.getStatus()) != CommerceOrderStatus.PENDING_PAYMENT) {
                return false;
            }
            boolean timeOver = order.getHoldExpiresAt() != null && !order.getHoldExpiresAt().after(new Date());
            boolean released = false;
            List<String> planIds = planIds(lineRepository.findByOrderIdOrderByLineNoAsc(commerceOrderId));
            if (!planIds.isEmpty()) {
                for (HoldRow hold : legacyRepository.findHoldsOfPlans(planIds)) {
                    if (!HELD.equals(hold.getStatus())) {
                        released = true;
                        break;
                    }
                }
            }
            if (!timeOver && !released) {
                return true;
            }
            expire(order, released && !timeOver ? REASON_SHOPPER_RELEASED : REASON_PAYMENT_EXPIRED);
            return false;
        });
        return Boolean.TRUE.equals(payable);
    }

    private boolean expire(String orderId, String reason) {
        CommerceOrder order = lockFresh(orderId);
        return expire(order, reason);
    }

    /** {@code order} is locked by the caller, or null. */
    private boolean expire(CommerceOrder order, String reason) {
        if (order == null || CommerceOrderStatus.of(order.getStatus()) != CommerceOrderStatus.PENDING_PAYMENT) {
            return false;
        }
        String orderId = order.getId();
        List<LogRow> logs = legacyRepository.findLogsOfGroup(order.getPaymentGroupId());
        if (logs.stream().anyMatch(row -> PAID.equals(row.getPaymentStatus()))) {
            // The money is in: the confirm step owns this order now.
            return false;
        }
        CommerceOrderTransitions.require(CommerceOrderStatus.PENDING_PAYMENT, CommerceOrderStatus.CANCELLED);
        if (StringUtils.hasText(order.getPrimaryPaymentLogId())) {
            // Holds the expiry job has not reached yet; a hold whose log turned PAID stays.
            stockHoldService.releaseForOrder(order.getPrimaryPaymentLogId());
        }
        List<String> planIds = planIds(lineRepository.findByOrderIdOrderByLineNoAsc(orderId));
        if (!planIds.isEmpty()) {
            legacyRepository.cancelPendingPlans(planIds);
        }
        tenderRepository.settlePending(orderId, CommerceOrderTender.STATUS_VOID, null, null);
        if (StringUtils.hasText(order.getAppliedCouponDiscountId())) {
            // The order took one use of its coupon at placement and was never paid: the use
            // goes back, once (this code runs once per order, under its row lock). An unlimited
            // coupon has nothing to give back.
            legacyRepository.giveCouponUseBack(order.getAppliedCouponDiscountId());
        }
        order.setStatus(CommerceOrderStatus.CANCELLED.name());
        order.setCancelReason(reason == null ? REASON_PAYMENT_EXPIRED : reason);
        order.setCancelledAt(new Date());
        orderRepository.save(order);
        writer.history(order, CommerceOrderStatus.PENDING_PAYMENT, CommerceOrderStatus.CANCELLED, null,
                order.getCancelReason());
        log.info("Commerce order {} ({}) cancelled unpaid: {}", order.getOrderNumber(), order.getId(),
                order.getCancelReason());
        return true;
    }
}
