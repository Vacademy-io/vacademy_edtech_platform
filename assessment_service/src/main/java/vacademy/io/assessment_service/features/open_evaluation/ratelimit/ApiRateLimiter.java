package vacademy.io.assessment_service.features.open_evaluation.ratelimit;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiProperties;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-key and per-institute request limits of the partner API, in memory, per pod (spec
 * 11.5 layer 1; same fixed-window pattern as admin_core's {@code PublicLeadRateLimiter}).
 *
 * <p>Not distributed: with N pods each enforces {@code ceil(limit / N)}, so the cluster as a
 * whole allows about the published limit when traffic is spread across pods. The
 * institute window stops one institute from multiplying the key limit by issuing more keys.
 *
 * <p>A request takes a permit from every window it touches (key/second, key/minute,
 * institute/second for reads and writes; key/minute and institute/minute for upload files)
 * or from none: a refusal gives back what it already took, so a throttled caller does not
 * burn its own budget.
 */
@Slf4j
@Component
public class ApiRateLimiter {

    public enum Kind { READ, WRITE, UPLOAD }

    /** Outcome plus what to put in the RateLimit-* headers (cluster-level numbers). */
    public record Decision(boolean allowed, int limit, int remaining, long resetSeconds) {
        /** Seconds a refused caller should wait (Retry-After). */
        public long retryAfterSeconds() {
            return Math.max(1, resetSeconds);
        }
    }

    private static final long SECOND_MS = 1_000;
    private static final long MINUTE_MS = 60_000;
    private static final int MAX_TRACKED_WINDOWS = 50_000;

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final Clock clock;
    private final int pods;

    @Autowired
    public ApiRateLimiter(OpenApiProperties properties) {
        this(Clock.systemUTC(), properties.getPods());
    }

    public ApiRateLimiter(Clock clock, int pods) {
        this.clock = clock;
        this.pods = Math.max(1, pods);
    }

    /** One request of the given kind (READ or WRITE). */
    public Decision acquire(ApiKeyPrincipal principal, Kind kind) {
        return acquire(principal, kind, 1);
    }

    /**
     * @param permits requests (READ/WRITE, normally 1) or files to presign (UPLOAD)
     */
    public Decision acquire(ApiKeyPrincipal principal, Kind kind, int permits) {
        if (principal == null || permits <= 0) {
            return new Decision(true, 0, 0, 0);
        }
        RateLimitTier tier = RateLimitTier.of(principal.getRateTier());
        String key = "k:" + principal.getKeyId();
        String inst = "i:" + principal.getInstituteId();
        List<Spec> specs = switch (kind) {
            case READ -> List.of(
                    new Spec(key + ":r:s", SECOND_MS, tier.keyReadsPerSecond()),
                    new Spec(key + ":r:m", MINUTE_MS, tier.keyReadsPerMinute()),
                    new Spec(inst + ":r:s", SECOND_MS, tier.instituteReadsPerSecond()));
            case WRITE -> List.of(
                    new Spec(key + ":w:s", SECOND_MS, tier.keyWritesPerSecond()),
                    new Spec(key + ":w:m", MINUTE_MS, tier.keyWritesPerMinute()),
                    new Spec(inst + ":w:s", SECOND_MS, tier.instituteWritesPerSecond()));
            case UPLOAD -> List.of(
                    new Spec(key + ":u:m", MINUTE_MS, tier.keyUploadsPerMinute()),
                    new Spec(inst + ":u:m", MINUTE_MS, tier.instituteUploadsPerMinute()));
        };
        return acquire(specs, permits);
    }

    private Decision acquire(List<Spec> specs, int permits) {
        long now = clock.millis();
        if (windows.size() > MAX_TRACKED_WINDOWS) {
            windows.entrySet().removeIf(e -> e.getValue().expired(now));
        }
        List<Taken> taken = new ArrayList<>(specs.size());
        Decision tightest = null;
        for (Spec spec : specs) {
            int podLimit = podShare(spec.limit());
            Window window = windows.computeIfAbsent(spec.name(), k -> new Window(spec.spanMs()));
            Taken result = window.tryTake(now, permits, podLimit);
            long reset = window.resetSeconds(now);
            if (!result.ok()) {
                taken.forEach(Taken::giveBack);
                log.info("Partner API rate limit hit on {} ({} per {} ms per pod)", spec.name(), podLimit, spec.spanMs());
                return new Decision(false, spec.limit(), 0, reset);
            }
            taken.add(result);
            int remaining = Math.min(spec.limit(), Math.max(0, (podLimit - result.usedAfter()) * pods));
            if (tightest == null || remaining < tightest.remaining()) {
                tightest = new Decision(true, spec.limit(), remaining, reset);
            }
        }
        return tightest == null ? new Decision(true, 0, 0, 0) : tightest;
    }

    int podShare(int clusterLimit) {
        return Math.max(1, (int) Math.ceil(clusterLimit / (double) pods));
    }

    private record Spec(String name, long spanMs, int limit) {
    }

    private static final class Window {
        private final long spanMs;
        private long startedAt = Long.MIN_VALUE;
        private int count;

        Window(long spanMs) {
            this.spanMs = spanMs;
        }

        synchronized Taken tryTake(long now, int permits, int limit) {
            roll(now);
            if (count + permits > limit) {
                return new Taken(this, false, count, 0);
            }
            count += permits;
            return new Taken(this, true, count, permits);
        }

        synchronized void giveBack(int permits) {
            count = Math.max(0, count - permits);
        }

        synchronized long resetSeconds(long now) {
            roll(now);
            long left = startedAt + spanMs - now;
            return Math.max(1, (left + 999) / 1000);
        }

        synchronized boolean expired(long now) {
            return startedAt != Long.MIN_VALUE && now >= startedAt + spanMs;
        }

        private void roll(long now) {
            if (startedAt == Long.MIN_VALUE || now >= startedAt + spanMs) {
                startedAt = now;
                count = 0;
            }
        }
    }

    private record Taken(Window window, boolean ok, int usedAfter, int permits) {
        void giveBack() {
            if (ok && permits > 0) {
                window.giveBack(permits);
            }
        }
    }
}
