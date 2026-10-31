package vacademy.io.admin_core_service.features.live_activity.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

@Component
@ConfigurationProperties(prefix = "live-activity")
@Data
public class LiveActivityProperties {

    private boolean enabled = true;

    private Sse sse = new Sse();
    private Buffer backfill = new Buffer();
    private Retention retention = new Retention();
    private Poll poll = new Poll();

    @Data
    public static class Sse {
        /**
         * Explicitly set rather than inherited. The telephony equivalents
         * (telephony.sse.keepalive-seconds / max-stream-seconds) are absent from every
         * properties file, so their :15 / :600 code defaults are silently what runs in prod.
         */
        private int keepaliveSeconds = 15;
        private int maxStreamSeconds = 1800;
        private int tokenTtlSeconds = 60;
    }

    @Data
    public static class Buffer {
        private int size = 100;
    }

    @Data
    public static class Poll {
        /**
         * How often a replica tails the table for events produced elsewhere. Only ticks
         * while this replica has an SSE subscriber, so a quiet institute costs nothing.
         *
         * <p>This is NOT the latency for most events: the replica that produced one
         * publishes to its own subscribers immediately.
         */
        private long intervalMillis = 300;

        /**
         * How far back each tick re-reads. Two rows can share a millisecond, and a strict
         * cursor would drop the second -- the bus suppresses the resulting echo by id, so
         * overlapping costs nothing but closes that gap.
         */
        private long overlapMillis = 2000;
    }

    @Data
    public static class Retention {
        private int days = 90;
        private int batchSize = 5000;

        /**
         * Per-category overrides. Call transitions dominate volume and go stale fastest,
         * while payments and enrolments are the rows worth keeping.
         */
        private Map<String, Integer> daysByCategory = new HashMap<>();

        /**
         * Case-insensitive on purpose. Spring's relaxed binding lower-cases map keys coming
         * from a properties file unless they are bracketed, so a literal
         * daysByCategory.get("CALL") would miss the configured value and every category
         * would silently fall back to the global window.
         */
        public int daysFor(String category) {
            if (category == null) {
                return days;
            }
            for (Map.Entry<String, Integer> entry : daysByCategory.entrySet()) {
                if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(category)
                        && entry.getValue() != null) {
                    return entry.getValue();
                }
            }
            return days;
        }
    }
}
