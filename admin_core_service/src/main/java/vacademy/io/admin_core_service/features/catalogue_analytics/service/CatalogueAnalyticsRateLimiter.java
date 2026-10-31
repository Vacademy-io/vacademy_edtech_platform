package vacademy.io.admin_core_service.features.catalogue_analytics.service;

import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Abuse ceiling for the public analytics beacon.
 *
 * Separate from PublicLeadRateLimiter on purpose. That one allows 8 requests
 * per IP per minute, which is right for form submissions and badly wrong here:
 * one visitor reading five pages would be throttled, and we would silently
 * under-count exactly the engaged visitors an admin most wants to see. These
 * limits are set to catch a script, not a reader.
 *
 * In-process, like the lead limiter — with several replicas the effective
 * ceiling is per-pod. That turns "unbounded" into "bounded and noisy", which
 * is the property that matters for a write endpoint with no auth.
 */
@Service
public class CatalogueAnalyticsRateLimiter {

    // A determined reader might open 30 pages in a minute. A script does 300.
    private static final int IP_PER_MINUTE = 60;
    private static final int IP_PER_HOUR = 600;

    // Safety ceiling only. A site featured somewhere can legitimately serve
    // thousands of views an hour, and losing real traffic data to a limiter
    // defeats the point of collecting it.
    private static final int INSTITUTE_PER_MINUTE = 3_000;
    private static final int INSTITUTE_PER_HOUR = 60_000;

    private static final Duration MINUTE = Duration.ofMinutes(1);
    private static final Duration HOUR = Duration.ofHours(1);

    private final Map<String, Window> minuteWindows = new ConcurrentHashMap<>();
    private final Map<String, Window> hourWindows = new ConcurrentHashMap<>();

    private static final class Window {
        private volatile Instant resetAt;
        private final AtomicInteger count = new AtomicInteger();

        Window(Instant resetAt) {
            this.resetAt = resetAt;
        }
    }

    private boolean allow(Map<String, Window> windows, String key, int limit, Duration period) {
        if (key == null || key.isBlank()) return true;
        Instant now = Instant.now();
        Window w = windows.computeIfAbsent(key, k -> new Window(now.plus(period)));
        synchronized (w) {
            if (now.isAfter(w.resetAt)) {
                w.count.set(0);
                w.resetAt = now.plus(period);
            }
            return w.count.incrementAndGet() <= limit;
        }
    }

    public boolean tryAcquire(String ip, String instituteId) {
        // Evaluate every window rather than short-circuiting, so one blocked
        // key does not let the others drift out of sync with real traffic.
        boolean ipMin = allow(minuteWindows, "ip:" + ip, IP_PER_MINUTE, MINUTE);
        boolean ipHour = allow(hourWindows, "ip:" + ip, IP_PER_HOUR, HOUR);
        boolean instMin = allow(minuteWindows, "in:" + instituteId, INSTITUTE_PER_MINUTE, MINUTE);
        boolean instHour = allow(hourWindows, "in:" + instituteId, INSTITUTE_PER_HOUR, HOUR);
        return ipMin && ipHour && instMin && instHour;
    }

    /** Bound memory: windows for keys that stopped sending are dead weight. */
    public void evictExpired() {
        Instant now = Instant.now();
        minuteWindows.entrySet().removeIf(e -> now.isAfter(e.getValue().resetAt.plus(MINUTE)));
        hourWindows.entrySet().removeIf(e -> now.isAfter(e.getValue().resetAt.plus(HOUR)));
    }
}
