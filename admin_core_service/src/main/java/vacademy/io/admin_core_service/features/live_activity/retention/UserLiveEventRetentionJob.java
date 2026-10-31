package vacademy.io.admin_core_service.features.live_activity.retention;

import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.live_activity.config.LiveActivityProperties;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * Nightly chunked delete, one pass per category so each can carry its own window.
 *
 * <p>Call transitions dominate volume and go stale within days, while payments and
 * enrolments are the rows anyone actually looks back at. A single global window would
 * therefore either hoard call noise or throw away the useful history.
 *
 * <p>Chunking keeps row locks short so the delete never blocks live traffic, and each pass
 * rides {@code idx_ule_inst_cat_time}.
 */
@Component
@RequiredArgsConstructor
public class UserLiveEventRetentionJob {

    private static final Logger log = LoggerFactory.getLogger(UserLiveEventRetentionJob.class);

    /** Bound the loop so a pathological run cannot spin all night. */
    private static final int MAX_BATCHES_PER_CATEGORY = 200;

    private final LiveActivityRetentionTxOps txOps;
    private final LiveActivityProperties properties;

    /**
     * {@code @SchedulerLock} is not optional here.
     *
     * <p>ShedLock is configured service-wide but only locks methods that are annotated, and
     * ten scheduled jobs in this service are currently unannotated and therefore run on
     * every replica. The existing admin-activity-log retention job is one of them --
     * harmless there only because its delete happens to be idempotent. Deliberately not
     * copying that omission.
     */
    @Scheduled(cron = "0 30 3 * * *", zone = "UTC")
    @SchedulerLock(name = "userLiveEventRetention", lockAtMostFor = "PT20M", lockAtLeastFor = "PT1M")
    public void purgeExpired() {
        for (LiveActivityCategory category : LiveActivityCategory.values()) {
            purgeCategory(category);
        }
    }

    private void purgeCategory(LiveActivityCategory category) {
        int days = properties.getRetention().daysFor(category.name());
        int batchSize = properties.getRetention().getBatchSize();
        Timestamp cutoff = Timestamp.from(Instant.now().minus(days, ChronoUnit.DAYS));

        int totalDeleted = 0;
        for (int batch = 0; batch < MAX_BATCHES_PER_CATEGORY; batch++) {
            int deleted = txOps.deleteBatch(category.name(), cutoff, batchSize);
            totalDeleted += deleted;
            if (deleted < batchSize) {
                break;
            }
        }

        if (totalDeleted > 0) {
            log.info("live activity retention: removed {} {} event(s) older than {} day(s)",
                    totalDeleted, category, days);
        }
    }
}
