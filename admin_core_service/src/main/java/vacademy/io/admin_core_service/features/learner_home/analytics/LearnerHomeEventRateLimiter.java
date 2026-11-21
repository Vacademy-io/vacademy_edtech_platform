package vacademy.io.admin_core_service.features.learner_home.analytics;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Token bucket per learner for the home analytics beacon: 300 events a minute, refilled
 * continuously. In-process (per pod), like the catalogue beacon limiter: it bounds abuse, it is not
 * an exact quota. Buckets of learners who stopped sending expire.
 */
@Component
public class LearnerHomeEventRateLimiter {

    public static final int CAPACITY = 300;
    private static final double REFILL_PER_NANO = CAPACITY / (double) Duration.ofMinutes(1).toNanos();

    private static final class Bucket {
        double tokens = CAPACITY;
        long lastNanos;

        Bucket(long now) {
            this.lastNanos = now;
        }
    }

    private final Cache<String, Bucket> buckets = Caffeine.newBuilder()
            .maximumSize(200_000)
            .expireAfterAccess(Duration.ofMinutes(5))
            .build();
    private final java.util.function.LongSupplier nanoClock;

    public LearnerHomeEventRateLimiter() {
        this(System::nanoTime);
    }

    LearnerHomeEventRateLimiter(java.util.function.LongSupplier nanoClock) {
        this.nanoClock = nanoClock;
    }

    /** How many of {@code requested} events this learner may send now (0..requested). */
    public int acquire(String userId, int requested) {
        if (userId == null || requested <= 0) return 0;
        long now = nanoClock.getAsLong();
        Bucket b = buckets.get(userId, k -> new Bucket(now));
        synchronized (b) {
            long elapsed = Math.max(0, now - b.lastNanos);
            b.tokens = Math.min(CAPACITY, b.tokens + elapsed * REFILL_PER_NANO);
            b.lastNanos = now;
            int granted = (int) Math.min(requested, Math.floor(b.tokens));
            b.tokens -= granted;
            return granted;
        }
    }
}
