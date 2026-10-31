package vacademy.io.admin_core_service.features.live_activity.core;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import vacademy.io.admin_core_service.features.live_activity.config.LiveActivityProperties;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityEvent;

import java.io.IOException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * In-process fan-out of live activity events to this replica's SSE subscribers, keyed by
 * institute.
 *
 * <p>Carries over the hardening proven in {@code CallEventBus}: serialise once per publish
 * rather than once per subscriber, heartbeat only emitters that have gone stale (real events
 * count as heartbeat), and deregister on completion/timeout/error.
 *
 * <p>Three deliberate differences from CallEventBus:
 * <ol>
 *   <li><b>No terminal state.</b> A call stream ends when the call does. An institute's
 *       activity stream never ends, so there is no complete()-on-terminal path.</li>
 *   <li><b>No in-memory replay buffer.</b> CallEventBus keeps the last event per call so a
 *       late subscriber still sees current state. Here the page backfills from
 *       {@code user_live_event} instead, which survives pod restarts and is identical on
 *       every replica.</li>
 *   <li><b>Per-subscriber category filtering.</b> Payments and counsellor activity are
 *       gated per role, and a client-side-only filter would still stream payment amounts to
 *       a counsellor's browser. Each subscription carries its allowed set and is checked
 *       before every write.</li>
 * </ol>
 *
 * <p>Cross-replica delivery is NOT this class's job -- {@link LiveActivityPoller} tails the
 * table and calls {@link #publishLocal} for anything produced elsewhere. This is what
 * CallEventBus never got, and why its multi-pod caveat does not apply here.
 *
 * <p>Both the recorder (immediately, for the replica that produced the event) and the
 * poller (for everything else) call {@link #publishLocal}, and the poller deliberately
 * re-reads a small overlap window. So the same event arrives here more than once by design,
 * and {@link #publishLocal} suppresses the repeats by id.
 */
@Component
@RequiredArgsConstructor
public class LiveActivityBus {

    private static final Logger log = LoggerFactory.getLogger(LiveActivityBus.class);

    private static final class Subscription {
        final SseEmitter emitter;
        /** Categories this viewer's role may see. Enforced on every write, not in the UI. */
        final Set<String> allowedCategories;
        volatile long lastSentNanos;

        Subscription(SseEmitter emitter, Set<String> allowedCategories) {
            this.emitter = emitter;
            this.allowedCategories = allowedCategories;
            this.lastSentNanos = System.nanoTime();
        }
    }

    private final ConcurrentHashMap<String, CopyOnWriteArrayList<Subscription>> subsByInstitute =
            new ConcurrentHashMap<>();

    /**
     * Ids delivered recently, so a repeat is dropped rather than shown twice.
     *
     * <p>Bounded LRU rather than an unbounded set: this runs for the lifetime of the pod, so
     * anything that only grows is a slow leak. The cap needs to exceed what one poll overlap
     * can contain, which it does by a wide margin.
     */
    private final Map<String, Boolean> recentlyPublished = Collections.synchronizedMap(
            new LinkedHashMap<>(1024, 0.75f, false) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                    return size() > 2000;
                }
            });

    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "live-activity-sse-heartbeat");
                t.setDaemon(true);
                return t;
            });

    private final ObjectMapper objectMapper;
    private final LiveActivityProperties properties;

    public void start() {
        scheduler.scheduleAtFixedRate(this::heartbeatIdle, 5, 5, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void shutdown() {
        scheduler.shutdownNow();
        subsByInstitute.values().forEach(list ->
                list.forEach(s -> {
                    try {
                        s.emitter.complete();
                    } catch (Exception ignored) {
                        // best effort on shutdown
                    }
                }));
        subsByInstitute.clear();
    }

    public SseEmitter subscribe(String instituteId, Set<String> allowedCategories) {
        SseEmitter emitter = new SseEmitter(properties.getSse().getMaxStreamSeconds() * 1000L);
        Subscription sub = new Subscription(emitter, allowedCategories);

        subsByInstitute.computeIfAbsent(instituteId, k -> new CopyOnWriteArrayList<>()).add(sub);

        emitter.onCompletion(() -> remove(instituteId, sub));
        emitter.onTimeout(() -> remove(instituteId, sub));
        emitter.onError(t -> remove(instituteId, sub));

        // No replay here on purpose -- the client backfills from GET /events before
        // attaching, and dedupes by eventId across the handoff.
        return emitter;
    }

    /**
     * Fan out to this replica's subscribers. Called both by the local recorder (so the
     * originating replica does not wait for its own notification to round-trip) and by the
     * listener for events produced elsewhere.
     */
    public void publishLocal(LiveActivityEvent event) {
        CopyOnWriteArrayList<Subscription> list = subsByInstitute.get(event.getInstituteId());
        if (list == null || list.isEmpty()) {
            return;
        }
        if (event.getEventId() != null
                && recentlyPublished.put(event.getEventId(), Boolean.TRUE) != null) {
            // Already delivered -- either the poller's overlap window re-read it, or this
            // replica produced it and published immediately before the poller saw it.
            return;
        }

        String category = event.getCategory() == null ? null : event.getCategory().name();

        String json;
        try {
            json = objectMapper.writeValueAsString(event);
        } catch (JsonProcessingException e) {
            log.warn("publishLocal: failed to serialise live activity event {}",
                    event.getEventId(), e);
            return;
        }

        for (Subscription sub : list) {
            if (category != null && !sub.allowedCategories.contains(category)) {
                continue;
            }
            sendJson(sub, category, json, event.getInstituteId());
        }
    }

    public int subscriberCount(String instituteId) {
        CopyOnWriteArrayList<Subscription> list = subsByInstitute.get(instituteId);
        return list == null ? 0 : list.size();
    }

    /**
     * Whether anyone on this replica is watching. The poller checks this first so a quiet
     * institute costs no queries at all.
     */
    public boolean hasSubscribers() {
        return !subsByInstitute.isEmpty();
    }

    private void sendJson(Subscription sub, String eventName, String json, String instituteId) {
        try {
            sub.emitter.send(SseEmitter.event().name(eventName).data(json));
            sub.lastSentNanos = System.nanoTime();
        } catch (IOException | IllegalStateException e) {
            log.debug("SSE send dropped for instituteId={}: {}", instituteId, e.getMessage());
        }
    }

    private void remove(String instituteId, Subscription sub) {
        CopyOnWriteArrayList<Subscription> list = subsByInstitute.get(instituteId);
        if (list != null) {
            list.remove(sub);
            if (list.isEmpty()) {
                subsByInstitute.remove(instituteId);
            }
        }
    }

    private void heartbeatIdle() {
        long thresholdNanos = TimeUnit.SECONDS.toNanos(properties.getSse().getKeepaliveSeconds());
        long now = System.nanoTime();
        for (CopyOnWriteArrayList<Subscription> list : subsByInstitute.values()) {
            for (Subscription sub : list) {
                if (now - sub.lastSentNanos < thresholdNanos) {
                    continue;
                }
                try {
                    sub.emitter.send(SseEmitter.event().name("ping").data("keepalive"));
                    sub.lastSentNanos = now;
                } catch (Exception ignored) {
                    // dropped -- reclaimed via the onError/onTimeout callbacks
                }
            }
        }
    }
}
