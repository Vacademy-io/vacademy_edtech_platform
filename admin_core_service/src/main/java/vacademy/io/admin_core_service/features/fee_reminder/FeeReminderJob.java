package vacademy.io.admin_core_service.features.fee_reminder;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Hourly, so each institute's reminders go out at its own local send hour. One replica runs it
 * (ShedLock); each step is sent once (fee_reminder_log). With no institute on the schedule this
 * is a single query an hour.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FeeReminderJob {

    private final FeeReminderService service;

    @Scheduled(cron = "0 15 * * * ?")
    @SchedulerLock(name = "FeeReminderJob", lockAtMostFor = "PT50M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            service.run();
        } catch (Exception e) {
            log.error("[fee-reminder] run failed", e);
        }
    }
}
