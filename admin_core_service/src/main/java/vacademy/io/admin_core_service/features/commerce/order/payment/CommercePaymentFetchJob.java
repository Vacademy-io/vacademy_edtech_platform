package vacademy.io.admin_core_service.features.commerce.order.payment;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.common.logging.SentryLogger;

import java.time.Duration;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The lost-webhook fetch: every minute it asks the gateway about shop payments whose captured
 * webhook has not arrived, so a paid order is confirmed even when the webhook is lost.
 *
 * <p>Which gateway orders (Razorpay, not paid, not settled, made in the last 48 hours):
 * <ul>
 *   <li><b>Open</b> (order PENDING_PAYMENT): two minutes after it was made, then 2, 3, 5, 5 and
 *       10 minutes after each fetch; then only the final fetch is left. The storefront's
 *       payment confirmation asks for a fetch 30 seconds later.</li>
 *   <li><b>Final</b> (order PENDING_PAYMENT, from 60 s before its hold time, until one fetch
 *       succeeds): the stock is held 3 minutes longer than the order, so this runs before
 *       the hold-expiry job expires the order. It wins over Open.</li>
 *   <li><b>Late</b> (order CANCELLED as unpaid or given back): 15 minutes after the final
 *       fetch or the cancel, then about 1 h, 6 h and 24 h apart; a capture found then takes the
 *       existing late-payment path.</li>
 * </ul>
 * At most {@value #MAX_PER_RUN} rows a run and {@value #MAX_PER_INSTITUTE} per institute; one
 * failing row does not stop the others. ShedLock keeps two pods apart, and the PAID claim keeps
 * a fetch and a webhook from settling one payment twice.
 *
 * <p>Log lines: {@code COMMERCE_FETCH run ...} per run with work, {@code COMMERCE_FETCH order=...}
 * per row, {@code COMMERCE_ALERT lost_webhook_recovered} when a fetch claimed a payment and
 * {@code COMMERCE_ALERT payment_fetch_failing} when one institute had
 * {@value #ERRORS_FOR_ALERT} errors in a run.
 */
@Slf4j
@Component
public class CommercePaymentFetchJob {

    static final int MAX_PER_RUN = 100;
    static final int MAX_PER_INSTITUTE = 25;
    static final int ERRORS_FOR_ALERT = 5;
    static final int MAX_LATE_FETCHES = 9;
    static final Duration LOOK_BACK = Duration.ofHours(48);
    static final Duration FINAL_LEAD = Duration.ofSeconds(60);
    static final Duration OPEN_FIRST_AFTER = Duration.ofMinutes(2);
    static final Duration LATE_FIRST_AFTER = Duration.ofMinutes(15);

    private final CommercePaymentGuard guard;
    private final CommercePaymentFetchService fetchService;

    public CommercePaymentFetchJob(CommercePaymentGuard guard, CommercePaymentFetchService fetchService) {
        this.guard = guard;
        this.fetchService = fetchService;
    }

    @Scheduled(cron = "${commerce.payment-fetch.cron:10 * * * * *}")
    @SchedulerLock(name = "CommercePaymentFetchJob", lockAtMostFor = "PT55S", lockAtLeastFor = "PT10S")
    public void run() {
        try {
            runOnce(new Date());
        } catch (Exception e) {
            log.error("COMMERCE_ALERT payment fetch job failed: {}", e.getClass().getSimpleName(), e);
            SentryLogger.logError(e, "Commerce payment fetch job failed");
        }
    }

    /** One run. Returns the count per outcome. Public for the database proof. */
    public Map<CommercePaymentFetchService.Outcome, Integer> runOnce(Date now) {
        long started = System.currentTimeMillis();
        List<CommercePaymentGuard.DueFetch> due = guard.dueFetches(now,
                new Date(now.getTime() - LOOK_BACK.toMillis()),
                new Date(now.getTime() + FINAL_LEAD.toMillis()),
                new Date(now.getTime() - OPEN_FIRST_AFTER.toMillis()),
                new Date(now.getTime() - LATE_FIRST_AFTER.toMillis()),
                MAX_LATE_FETCHES, MAX_PER_INSTITUTE, MAX_PER_RUN);
        Map<CommercePaymentFetchService.Outcome, Integer> counts = new HashMap<>();
        Map<String, Integer> errorsByInstitute = new HashMap<>();
        Map<String, Integer> rowsByInstitute = new HashMap<>();
        int handled = 0;
        for (CommercePaymentGuard.DueFetch row : due) {
            if (handled >= MAX_PER_RUN) {
                break;
            }
            // The query caps rows per institute already; this keeps the cap if it changes.
            if (rowsByInstitute.merge(row.instituteId(), 1, Integer::sum) > MAX_PER_INSTITUTE) {
                continue;
            }
            handled++;
            CommercePaymentFetchService.Outcome outcome;
            try {
                outcome = fetchService.fetch(row, CommercePaymentFetchService.kindOf(row, now, FINAL_LEAD), now);
            } catch (Exception e) {
                outcome = CommercePaymentFetchService.Outcome.ERROR;
                log.error("COMMERCE_ALERT payment fetch of gateway order {} failed: {}", row.gatewayOrderId(),
                        e.getClass().getSimpleName());
            }
            counts.merge(outcome, 1, Integer::sum);
            if (outcome == CommercePaymentFetchService.Outcome.ERROR
                    && errorsByInstitute.merge(row.instituteId(), 1, Integer::sum) == ERRORS_FOR_ALERT) {
                log.error("COMMERCE_ALERT payment_fetch_failing institute={} errors={}", row.instituteId(),
                        ERRORS_FOR_ALERT);
            }
        }
        if (handled > 0) {
            int fetched = handled - counts.getOrDefault(CommercePaymentFetchService.Outcome.ERROR, 0);
            log.info("COMMERCE_FETCH run due={} fetched={} confirmed={} authorized={} none={} errors={} ms={}",
                    handled, fetched,
                    counts.getOrDefault(CommercePaymentFetchService.Outcome.CONFIRMED, 0),
                    counts.getOrDefault(CommercePaymentFetchService.Outcome.AUTHORIZED, 0),
                    counts.getOrDefault(CommercePaymentFetchService.Outcome.NO_PAYMENT, 0)
                            + counts.getOrDefault(CommercePaymentFetchService.Outcome.FAILED_ONLY, 0),
                    counts.getOrDefault(CommercePaymentFetchService.Outcome.ERROR, 0),
                    System.currentTimeMillis() - started);
        }
        return counts;
    }
}
