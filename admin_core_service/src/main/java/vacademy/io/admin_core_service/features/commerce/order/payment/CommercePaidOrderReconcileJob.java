package vacademy.io.admin_core_service.features.commerce.order.payment;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.common.logging.SentryLogger;

import java.time.Duration;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The recovery path of the checkout.
 * Two sweeps, every two minutes:
 * <ol>
 *   <li><b>Paid, not confirmed.</b> An order with a PAID payment log that is still
 *       PENDING_PAYMENT or CANCELLED and that the order code has not dealt with: the confirm
 *       step after the PAID claim failed or never ran (a pod died between the commit and the
 *       callback). {@code ensurePaidOrderConfirmed} is called for it, and every order found
 *       here is logged as an alert: once when the job confirms it, on every run while it
 *       stays unconfirmed.</li>
 *   <li><b>Unpaid, hold time over.</b> An order still PENDING_PAYMENT after its hold time,
 *       with no PAID log and no stock still held: the expiry hook did not run for it (a made
 *       to order line has no hold, or the hook failed). {@code onHoldExpired} is called for
 *       it.</li>
 * </ol>
 * Both calls are idempotent on the order side. The ShedLock only stops four pods doing the
 * same sweep. No sweep holds a transaction; each order is handled by itself, and one that
 * fails does not stop the rest.
 *
 * <p>An alert is an ERROR log line that starts with {@code COMMERCE_ALERT}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommercePaidOrderReconcileJob {

    static final int BATCH = 200;
    /** How far back the sweeps look. An older order is a case for a person, not for a job. */
    static final Duration LOOK_BACK = Duration.ofDays(7);
    /** An unpaid order is given this long after its hold time before the sweep cancels it. */
    static final Duration EXPIRY_GRACE = Duration.ofMinutes(3);

    private final CommercePaymentGuard guard;
    private final CommercePaymentConfirmService confirmService;
    private final CommerceOrderPaymentPort orders;
    private final CommerceStockSettings stockSettings;

    /** A payment seen less than this long ago is left to its own confirm step. */
    static final Duration SETTLE_TIME = Duration.ofMinutes(1);

    @Scheduled(cron = "${commerce.reconcile.cron:20 1/2 * * * *}")
    @SchedulerLock(name = "CommercePaidOrderReconcileJob", lockAtMostFor = "PT110S", lockAtLeastFor = "PT20S")
    public void run() {
        try {
            reconcile(new Date());
        } catch (Exception e) {
            log.error("COMMERCE_ALERT paid-order reconcile job failed: {}", e.getMessage(), e);
            SentryLogger.logError(e, "Commerce paid-order reconcile job failed");
        }
    }

    /** One run. Returns {confirmed, still open, expired}. Package-visible for the test. */
    int[] reconcile(Date now) {
        Date since = new Date(now.getTime() - LOOK_BACK.toMillis());
        int confirmed = 0;
        int open = 0;
        Date paymentSeenBefore = new Date(now.getTime() - SETTLE_TIME.toMillis());
        for (String orderId : guard.paidOrdersNotConfirmed(since, paymentSeenBefore, BATCH)) {
            boolean done;
            try {
                done = confirmService.ensureConfirmed(orderId);
            } catch (Exception e) {
                done = false;
                log.error("COMMERCE_ALERT paid order {} could not be confirmed by the job: {}", orderId,
                        e.getMessage(), e);
            }
            if (done) {
                confirmed++;
                log.error("COMMERCE_ALERT paid order {} was not settled by its payment; the job settled it",
                        orderId);
            } else {
                open++;
                alertOpen(orderId);
            }
        }

        int expired = 0;
        Map<String, Integer> holdMinutes = new HashMap<>();
        // An order without a hold time is tested against its institute's setting below.
        Date createdBefore = new Date(now.getTime() - Duration.ofMinutes(1).toMillis());
        Date expiredBefore = new Date(now.getTime() - EXPIRY_GRACE.toMillis());
        List<CommercePaymentGuard.DueOrder> due = guard.unpaidOrdersPastHold(expiredBefore, createdBefore, since,
                BATCH);
        for (CommercePaymentGuard.DueOrder order : due) {
            if (order.holdExpiresAt() == null) {
                int minutes = holdMinutes.computeIfAbsent(order.instituteId(), stockSettings::holdMinutes);
                long over = order.createdAt() == null ? Long.MAX_VALUE
                        : order.createdAt().getTime() + Duration.ofMinutes(minutes).toMillis()
                        + EXPIRY_GRACE.toMillis();
                if (now.getTime() < over) {
                    continue;
                }
            }
            try {
                orders.onHoldExpired(order.id());
                expired++;
            } catch (Exception e) {
                log.error("COMMERCE_ALERT unpaid order {} is past its hold time and could not be expired: {}",
                        order.id(), e.getMessage(), e);
            }
        }
        if (confirmed > 0 || open > 0 || expired > 0) {
            log.info("Commerce reconcile: {} paid order(s) confirmed, {} still open, {} unpaid order(s) expired",
                    confirmed, open, expired);
        }
        return new int[] {confirmed, open, expired};
    }

    private void alertOpen(String orderId) {
        try {
            guard.order(orderId).ifPresent(order -> log.error(
                    "COMMERCE_ALERT order {} of institute {} has a PAID payment and is still {}",
                    order.id(), order.instituteId(), order.status()));
        } catch (Exception e) {
            log.error("COMMERCE_ALERT order {} has a PAID payment and is not confirmed", orderId);
        }
    }
}
