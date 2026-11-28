package vacademy.io.admin_core_service.features.suborg.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgExitService;

/**
 * Ends the access of a sub-org's staff once its admin has left: straight after a hard exit, and on
 * the last access date after a soft cancel. Every 5 minutes, one replica per tick.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SubOrgMemberCascadeJob {

    private final SubOrgExitService subOrgExitService;

    @Scheduled(cron = "0 */5 * * * *", zone = "UTC")
    @SchedulerLock(name = "SubOrgMemberCascadeJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            subOrgExitService.processDue();
        } catch (Exception e) {
            log.error("Sub-org staff cascade sweep failed", e);
        }
    }
}
