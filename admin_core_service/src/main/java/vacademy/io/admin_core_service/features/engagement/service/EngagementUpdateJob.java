package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;

/** Starts updates when their time comes and closes them when it passes. */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementUpdateJob {

    private final EngagementUpdateService updateService;

    @Scheduled(fixedDelayString = "${engagement.updates.delay-ms:300000}",
            initialDelayString = "${engagement.updates.initial-delay-ms:150000}")
    @SchedulerLock(name = "EngagementUpdates", lockAtMostFor = "PT5M", lockAtLeastFor = "PT10S")
    public void sweep() {
        Instant now = Instant.now();
        try {
            // Closing first: an update that both started and ended between runs is never announced.
            updateService.closeEnded(now);
            updateService.announceDue(now);
        } catch (Exception e) {
            log.warn("Engagement update sweep failed: {}", e.getMessage());
        }
    }
}
