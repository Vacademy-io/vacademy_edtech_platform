package vacademy.io.admin_core_service.features.enrolment_break.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakService;

/**
 * Starts breaks whose first day has come and ends breaks whose last day is over
 * (docs/ENROLMENT_BREAKS.md). Hourly, so every institute's own midnight is caught within the hour.
 * Each break is checked against its institute's date before anything changes, and an empty table
 * makes this two indexed queries an hour.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class EnrolmentBreakJob {

    private final EnrolmentBreakService service;

    @Scheduled(cron = "0 5 * * * ?")
    @SchedulerLock(name = "EnrolmentBreakJob", lockAtMostFor = "PT50M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            int[] r = service.sweep();
            if (r[0] > 0 || r[1] > 0) {
                log.info("[enrolment-break] sweep: {} started, {} ended", r[0], r[1]);
            }
        } catch (Exception e) {
            log.error("[enrolment-break] sweep failed", e);
        }
    }
}
