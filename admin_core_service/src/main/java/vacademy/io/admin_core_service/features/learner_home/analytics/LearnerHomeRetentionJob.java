package vacademy.io.admin_core_service.features.learner_home.analytics;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;

import java.time.Duration;
import java.time.Instant;

/** Deletes learner-home click/dismiss/ack rows older than 180 days, nightly, in batches. Daily view totals are kept. */
@Slf4j
@Component
public class LearnerHomeRetentionJob {

    static final Duration RETENTION = Duration.ofDays(180);
    static final int BATCH = 10_000;
    static final int MAX_BATCHES = 200;

    private final LearnerHomeJdbc jdbc;

    public LearnerHomeRetentionJob(LearnerHomeJdbc jdbc) {
        this.jdbc = jdbc;
    }

    // 21:40 UTC = 03:10 IST, a quiet hour.
    @Scheduled(cron = "0 40 21 * * *", zone = "UTC")
    @SchedulerLock(name = "LearnerHomeRetentionJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        purge(Instant.now().minus(RETENTION));
    }

    int purge(Instant cutoff) {
        int total = 0;
        try {
            for (int i = 0; i < MAX_BATCHES; i++) {
                int n = jdbc.deleteEventsBefore(cutoff, BATCH);
                total += n;
                if (n < BATCH) break;
            }
        } catch (RuntimeException e) {
            log.warn("[learner-home] retention stopped after {} rows: {}", total, e.getMessage());
        }
        if (total > 0) log.info("[learner-home] retention deleted {} event rows", total);
        return total;
    }
}
