package vacademy.io.community_service.feature.appregistry.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Keeps every registered app's store status current without anyone asking.
 *
 * <p>The dashboard has always been able to pull a live status on demand, but nobody opens the
 * dashboard for an app that is quietly sitting on the store — so what an institute admin read on
 * their own settings page was whatever someone last typed or last happened to refresh. This turns
 * that into tracking: a review that starts overnight, a release that goes live on Saturday, or an
 * app the store pulls shows up on its own.
 *
 * <p>Deliberately infrequent. Store review states change over hours and days, not minutes, and
 * every sweep spends one API call per platform against quotas shared with the release tooling —
 * four times a day answers "did anything change today" without ever being the reason a Play or
 * App Store Connect quota runs out. It is also idempotent: a sweep that changes nothing writes the
 * same values back, so a duplicate run costs calls, never correctness.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class StoreStatusScheduler {

    private final StoreStatusSyncService storeStatusSyncService;

    @Value("${appregistry.store-sync.enabled:true}")
    private boolean enabled;

    /**
     * 06:10, 12:10, 18:10 and 00:10 IST. Ten past the hour rather than on it, so this never lines
     * up with the hourly jobs the rest of the platform runs on the hour.
     */
    @Scheduled(cron = "${appregistry.store-sync.cron:0 10 0,6,12,18 * * *}", zone = "Asia/Kolkata")
    public void syncAllStoreStatuses() {
        if (!enabled) {
            log.debug("[StoreStatusScheduler] Disabled by appregistry.store-sync.enabled=false");
            return;
        }
        try {
            StoreStatusSyncService.SweepResult result = storeStatusSyncService.syncAll();
            log.info("[StoreStatusScheduler] Store status sweep: {} synced, {} skipped, {} failed",
                    result.synced(), result.skipped(), result.failed());
        } catch (Exception e) {
            // A scheduled task that throws is silently dropped by Spring's default error handler
            // and the next run still happens — but the reason would never appear anywhere.
            log.error("[StoreStatusScheduler] Store status sweep failed outright: {}", e.getMessage(), e);
        }
    }
}
