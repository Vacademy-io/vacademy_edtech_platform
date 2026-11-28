package vacademy.io.admin_core_service.features.learner_home.analytics;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

/**
 * Counts VIEW events in memory and writes them every 30 seconds as daily totals (one upsert row
 * per institute, institute-local day, block, item and device). Views are high volume, so they are
 * never stored one row each. If a pod dies, up to 30 seconds of views are lost.
 */
@Slf4j
@Component
public class LearnerHomeViewAggregator {

    public record ViewKey(String instituteId, LocalDate day, String blockKey, String itemKey, String device) {
    }

    private final LearnerHomeJdbc jdbc;
    private final InstituteTimezoneService timezoneService;
    private final ConcurrentHashMap<ViewKey, LongAdder> counts = new ConcurrentHashMap<>();
    private final Cache<String, ZoneId> zones = Caffeine.newBuilder()
            .maximumSize(20_000).expireAfterWrite(Duration.ofMinutes(10)).build();

    public LearnerHomeViewAggregator(LearnerHomeJdbc jdbc, InstituteTimezoneService timezoneService) {
        this.jdbc = jdbc;
        this.timezoneService = timezoneService;
    }

    public ZoneId zone(String instituteId) {
        return zones.get(instituteId, id -> {
            try {
                return timezoneService.getZone(id);
            } catch (RuntimeException e) {
                return InstituteTimezoneService.DEFAULT_ZONE;
            }
        });
    }

    public void record(String instituteId, String blockKey, String itemKey, String device, Instant at) {
        LocalDate day = at.atZone(zone(instituteId)).toLocalDate();
        counts.computeIfAbsent(new ViewKey(instituteId, day, blockKey, itemKey == null ? "" : itemKey, device),
                k -> new LongAdder()).increment();
    }

    @Scheduled(fixedDelay = 30_000L, initialDelay = 30_000L)
    public void scheduledFlush() {
        flush();
    }

    @PreDestroy
    public void flushOnShutdown() {
        flush();
    }

    /** Drains the counters and writes them; counts that fail to write are put back for the next flush. */
    public synchronized int flush() {
        if (counts.isEmpty()) return 0;
        List<LearnerHomeJdbc.ViewRow> rows = new ArrayList<>();
        for (Map.Entry<ViewKey, LongAdder> e : counts.entrySet()) {
            long n = e.getValue().sumThenReset();
            if (n > 0) {
                ViewKey k = e.getKey();
                rows.add(new LearnerHomeJdbc.ViewRow(k.instituteId(), k.day(), k.blockKey(), k.itemKey(), k.device(), n));
            }
        }
        // Counters of past days are dropped once drained; today's stay, so a concurrent increment
        // always lands on a counter that is still in the map.
        LocalDate keepFrom = LocalDate.now(java.time.ZoneOffset.UTC).minusDays(2);
        counts.entrySet().removeIf(e -> e.getKey().day().isBefore(keepFrom) && e.getValue().sum() == 0);
        if (rows.isEmpty()) return 0;
        try {
            jdbc.upsertViews(rows);
            return rows.size();
        } catch (RuntimeException ex) {
            log.warn("[learner-home] view flush failed ({} rows), kept for the next try: {}", rows.size(),
                    ex.getMessage());
            for (LearnerHomeJdbc.ViewRow r : rows) {
                counts.computeIfAbsent(new ViewKey(r.instituteId(), r.day(), r.blockKey(), r.itemKey(), r.device()),
                        k -> new LongAdder()).add(r.views());
            }
            return 0;
        }
    }

    int pendingKeys() {
        return counts.size();
    }
}
