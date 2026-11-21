package vacademy.io.admin_core_service.features.stock_hold.scheduler;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;

/**
 * Gives back stock held by checkouts that were never paid: a closed tab or a locked phone never
 * reaches the storefront's release call, and Razorpay sends no webhook when its window closes.
 * A hold lives {@link StockHoldService#HOLD_MINUTES}; this runs every 2 minutes, so stock comes
 * back at most ~2 minutes after its hold expires.
 *
 * <p>The ShedLock only stops 4 pods doing the same sweep; correctness comes from the
 * compare-and-set release (a row is released once, and never once its payment log is PAID).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class StockHoldExpiryJob {

    private final StockHoldService stockHoldService;

    /** Every 2 minutes, offset to :40 seconds to stay clear of the jobs that fire on the minute. */
    @Scheduled(cron = "${stock-hold.expiry.cron:40 */2 * * * *}")
    @SchedulerLock(name = "StockHoldExpiryJob", lockAtMostFor = "PT110S", lockAtLeastFor = "PT20S")
    public void releaseExpiredHolds() {
        try {
            stockHoldService.releaseExpired(); // logs its own count
        } catch (Exception e) {
            log.error("StockHoldExpiryJob failed: {}", e.getMessage(), e);
        }
    }
}
