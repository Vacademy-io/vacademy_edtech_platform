package vacademy.io.admin_core_service.features.marketing.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.marketing.service.SocialPublishService;
import vacademy.io.common.logging.SentryLogger;

import java.util.Map;

/**
 * Publishes due social posts every {@code marketing.social.publish.interval-ms} (default 1 min).
 * ShedLock keeps the pass on one pod at a time; posts are additionally claimed with FOR UPDATE
 * SKIP LOCKED and each target with a compare-and-set, so a post-now publish running on a request
 * pod at the same moment never double-posts.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SocialPostPublishJob {

    private final SocialPublishService publishService;

    @Value("${marketing.social.publish.enabled:true}")
    private boolean enabled;

    @Scheduled(fixedDelayString = "${marketing.social.publish.interval-ms:60000}",
            initialDelayString = "${marketing.social.publish.initial-delay-ms:90000}")
    @SchedulerLock(name = "MarketingSocialPublishJob", lockAtMostFor = "PT10M", lockAtLeastFor = "PT20S")
    public void publishDuePosts() {
        if (!enabled) {
            log.debug("SocialPostPublishJob: disabled, skipping");
            return;
        }
        try {
            publishService.runPublishCycle();
        } catch (Exception e) {
            log.error("SocialPostPublishJob: pass failed", e);
            SentryLogger.logWarning("Social post publish job failed: " + e.getMessage(),
                    Map.of("feature", "marketing_social", "job", "MarketingSocialPublishJob"));
        }
    }
}
