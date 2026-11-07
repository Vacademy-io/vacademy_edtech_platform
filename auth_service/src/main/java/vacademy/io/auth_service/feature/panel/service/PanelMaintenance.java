package vacademy.io.auth_service.feature.panel.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;

import java.util.concurrent.atomic.AtomicLong;

/**
 * Lazy cleanup with no scheduler: at most once a minute per pod, from pair/start and challenge, in a
 * bounded batch. Pairings go 1 hour past expiry, challenges 1 day past. panel_session and panel_device
 * rows stay as the audit trail.
 */
@Component
public class PanelMaintenance {

    private static final Logger log = LoggerFactory.getLogger(PanelMaintenance.class);
    private static final long INTERVAL_MS = 60_000L;
    private static final int BATCH = 500;

    private final PanelRepository repository;
    private final AtomicLong nextRunAt = new AtomicLong();

    public PanelMaintenance(PanelRepository repository) {
        this.repository = repository;
    }

    public void maybePurge() {
        long now = System.currentTimeMillis();
        long due = nextRunAt.get();
        if (now < due || !nextRunAt.compareAndSet(due, now + INTERVAL_MS)) {
            return;
        }
        try {
            repository.purgeOldPairings(BATCH);
            repository.purgeOldChallenges(BATCH);
        } catch (RuntimeException e) {
            log.warn("Panel cleanup failed: {}", e.getClass().getSimpleName());
        }
    }
}
