package vacademy.io.admin_core_service.features.journey_status.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.journey_status.service.JourneyRiskService;

/**
 * The daily At Risk check (see {@link JourneyRiskService}), 07:30 IST, after the night's classes
 * have ended. One replica runs it (ShedLock). With no institute on the check this is a single
 * query a day. Status only: nothing is sent.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JourneyRiskJob {

    /** Shared with the manual run (JourneyStatusController), so the two never overlap. */
    public static final String LOCK_NAME = "JourneyRiskJob";

    private final JourneyRiskService service;

    @Scheduled(cron = "0 0 2 * * ?", zone = "UTC")
    @SchedulerLock(name = LOCK_NAME, lockAtMostFor = "PT50M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            int[] r = service.run();
            if (r[0] > 0 || r[1] > 0) log.info("[journey-status] At Risk check: {} marked, {} returned", r[0], r[1]);
        } catch (Exception e) {
            log.error("[journey-status] At Risk check failed", e);
        }
    }
}
