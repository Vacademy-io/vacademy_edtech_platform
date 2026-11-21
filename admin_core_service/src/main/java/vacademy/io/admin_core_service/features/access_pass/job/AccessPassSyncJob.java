package vacademy.io.admin_core_service.features.access_pass.job;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.access_pass.service.AccessPassSyncService;

/**
 * Safety-net sweep for access passes, every 10 minutes. Item changes already trigger an
 * immediate sync; this catches what that cannot: ledger catch-up for new buyers, COVERED
 * courses whose covering membership lapsed, and retries of plans that failed earlier.
 * An up-to-date pass costs one query (AccessPassRepository.findHolderPlanIdsNeedingSync).
 *
 * <p>{@code @SchedulerLock}: one replica per tick. Each pass additionally takes its own
 * lock inside {@link AccessPassSyncService#syncPass}, shared with on-demand syncs.
 */
@Slf4j
@Component
public class AccessPassSyncJob {

    private final AccessPassSyncService syncService;

    public AccessPassSyncJob(AccessPassSyncService syncService) {
        this.syncService = syncService;
    }

    @Scheduled(cron = "0 3/10 * * * *", zone = "UTC")
    @SchedulerLock(name = "AccessPassSyncJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            syncService.syncAll();
        } catch (Exception e) {
            log.error("[access-pass] sync sweep failed", e);
        }
    }
}
