package vacademy.io.admin_core_service.features.live_activity.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.live_activity.config.LiveActivityProperties;
import vacademy.io.admin_core_service.features.live_activity.entity.UserLiveEvent;
import vacademy.io.admin_core_service.features.live_activity.repository.UserLiveEventRepository;

import java.sql.Timestamp;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Cross-replica delivery: tails {@code user_live_event} and hands anything new to this
 * replica's {@link LiveActivityBus}.
 *
 * <p><b>Why polling rather than Postgres LISTEN/NOTIFY.</b> Every service here connects
 * through PgBouncer in {@code pool_mode = transaction}. NOTIFY is fine that way, but LISTEN
 * is not: the subscription lives on a server connection that the pooler hands to another
 * client as soon as the transaction ends, so it appears to succeed and then silently
 * delivers nothing. Working around that needs a connection that bypasses PgBouncer, which
 * means a new secret, a direct network path, and a failure mode that only shows up as an
 * inexplicably quiet feed. Tailing a table costs ~150ms of average latency and removes all
 * of it.
 *
 * <p><b>It costs nothing when nobody is looking.</b> The tick returns immediately unless
 * this replica has at least one SSE subscriber, so an institute with the feed closed
 * generates zero queries. With viewers, it is one indexed query per tick regardless of how
 * many people are watching.
 *
 * <p><b>Latency is lower than the tick suggests.</b> The replica that produced an event
 * publishes to its own subscribers immediately, so only events from <i>other</i> replicas
 * wait for a tick.
 *
 * <p>Deliberately NOT {@code @SchedulerLock}ed, which is the opposite of the retention job:
 * every replica must poll, because each one has its own subscribers to feed.
 */
@Component
public class LiveActivityPoller {

    private static final Logger log = LoggerFactory.getLogger(LiveActivityPoller.class);

    private final LiveActivityProperties properties;
    private final LiveActivityBus bus;
    private final UserLiveEventRepository repository;
    private final ObjectMapper objectMapper;

    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "live-activity-poller");
                t.setDaemon(true);
                return t;
            });

    /** High-water mark. Null until the first tick with a subscriber. */
    private volatile Timestamp cursor;

    public LiveActivityPoller(LiveActivityProperties properties,
                              LiveActivityBus bus,
                              UserLiveEventRepository repository,
                              ObjectMapper objectMapper) {
        this.properties = properties;
        this.bus = bus;
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        bus.start();
        if (!properties.isEnabled()) {
            log.info("live activity disabled, poller not started");
            return;
        }
        long interval = properties.getPoll().getIntervalMillis();
        // Own thread, not the shared @Scheduled pool: Spring's default scheduler is
        // single-threaded, and a 300ms task on it would contend with the other scheduled
        // jobs in this service.
        scheduler.scheduleWithFixedDelay(this::tick, interval, interval, TimeUnit.MILLISECONDS);
        log.info("live activity poller started, interval={}ms", interval);
    }

    @PreDestroy
    public void stop() {
        scheduler.shutdownNow();
    }

    private void tick() {
        try {
            if (!bus.hasSubscribers()) {
                // Nobody is watching. Drop the cursor so the next viewer starts from "now"
                // rather than replaying everything that happened while the page was closed
                // -- that is what the backfill query is for.
                cursor = null;
                return;
            }

            Timestamp from = cursor;
            if (from == null) {
                cursor = new Timestamp(System.currentTimeMillis());
                return;
            }

            // Re-read a small overlap. Two rows can share a millisecond, and a strict
            // "greater than the last timestamp" cursor would drop the second one. It also
            // absorbs clock skew between pods, since occurred_at is stamped by the app
            // rather than the database. The bus suppresses the resulting echo by event id,
            // so overlapping costs nothing.
            Timestamp since = new Timestamp(from.getTime() - properties.getPoll().getOverlapMillis());
            List<UserLiveEvent> rows =
                    repository.findTop200ByOccurredAtGreaterThanOrderByOccurredAtAsc(since);

            for (UserLiveEvent row : rows) {
                bus.publishLocal(LiveActivityEventMapper.toEvent(row, objectMapper));
                if (row.getOccurredAt() != null && row.getOccurredAt().after(cursor)) {
                    cursor = row.getOccurredAt();
                }
            }
        } catch (Exception e) {
            // Never let a failed tick kill the scheduled task -- scheduleWithFixedDelay
            // cancels the whole schedule if the runnable throws.
            log.warn("live activity poll failed: {}", e.getMessage());
        }
    }
}
