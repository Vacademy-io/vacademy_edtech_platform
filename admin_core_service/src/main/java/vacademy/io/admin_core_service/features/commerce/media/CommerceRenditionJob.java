package vacademy.io.admin_core_service.features.commerce.media;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Every minute: makes the renditions of gallery images that have none yet (imported rows, a
 * dropped after-commit request), tries again what failed for a passing reason, and takes over
 * rows a stopped pod left claimed. The claim on each row keeps two pods off the same image.
 */
@Slf4j
@Component
public class CommerceRenditionJob {

    private static final int BATCH = 60;
    private static final long BUDGET_MILLIS = 5 * 60 * 1000L;

    private final CommerceRenditionService renditionService;
    private final boolean enabled;
    private final long pauseMillis;

    public CommerceRenditionJob(CommerceRenditionService renditionService,
                                @Value("${commerce.rendition.job.enabled:true}") boolean enabled,
                                @Value("${commerce.rendition.job.pause-millis:1000}") long pauseMillis) {
        this.renditionService = renditionService;
        this.enabled = enabled;
        this.pauseMillis = Math.max(0, pauseMillis);
    }

    @Scheduled(cron = "20 * * * * *", zone = "UTC")
    @SchedulerLock(name = "CommerceRenditionJob", lockAtMostFor = "PT1M", lockAtLeastFor = "PT20S")
    public void run() {
        if (!enabled) {
            return;
        }
        try {
            // Only starts the pass: the calls to the media service run on a thread of their own, never
            // on the scheduler thread (four threads for every scheduled job of this service).
            renditionService.processDueInBackground(BATCH, BUDGET_MILLIS, pauseMillis);
        } catch (Exception e) {
            log.error("COMMERCE_ALERT rendition job failed: {}", e.getMessage(), e);
        }
    }
}
