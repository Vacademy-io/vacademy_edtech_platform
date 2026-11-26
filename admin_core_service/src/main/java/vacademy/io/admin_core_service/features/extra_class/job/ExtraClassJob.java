package vacademy.io.admin_core_service.features.extra_class.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.extra_class.service.ExtraClassService;

/**
 * Switches on extra classes whose first day has come and marks finished ones EXPIRED. Hourly, so
 * every institute's own midnight is caught within the hour. Sends nothing.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ExtraClassJob {

    private final ExtraClassService service;

    @Scheduled(cron = "0 10 * * * ?")
    @SchedulerLock(name = "ExtraClassJob", lockAtMostFor = "PT50M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            int[] r = service.sweep();
            if (r[0] > 0 || r[1] > 0) {
                log.info("[extra-class] sweep: {} started, {} expired", r[0], r[1]);
            }
        } catch (Exception e) {
            log.error("[extra-class] sweep failed", e);
        }
    }
}
