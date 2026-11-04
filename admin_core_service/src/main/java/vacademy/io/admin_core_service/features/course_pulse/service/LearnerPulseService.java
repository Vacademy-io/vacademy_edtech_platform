package vacademy.io.admin_core_service.features.course_pulse.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.course_pulse.repository.PulseRepository;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One learner live pulse for the side view Academic Activity tab: whether they are learning
 * right now (same windows as Course Pulse), the slide they are on, and the slides they read
 * most recently with time spent. Read-only.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerPulseService {

    private static final int RECENT_DAYS = 30;
    private static final int RECENT_ROWS = 15;

    private final PulseRepository pulseRepository;

    @Value("${pulse.active-window-seconds:120}")
    private long activeWindowSeconds;

    @Value("${pulse.offline-window-seconds:300}")
    private long offlineWindowSeconds;

    public Map<String, Object> learnerPulse(String userId) {
        Instant now = Instant.now();
        List<Object[]> rows = List.of();
        try {
            rows = pulseRepository.getLearnerRecentSlides(userId,
                    Timestamp.from(now.minus(RECENT_DAYS, ChronoUnit.DAYS)), RECENT_ROWS);
        } catch (Exception e) {
            log.warn("[LearnerPulse] recent slides failed for user={}: {}", userId, e.getMessage());
        }
        List<Map<String, Object>> recent = new ArrayList<>();
        for (Object[] r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("slide_id", str(r[0]));
            m.put("title", str(r[1]));
            m.put("type", str(r[2]));
            m.put("chapter", str(r[3]));
            Instant seen = instant(r[4]);
            m.put("last_seen_at", seen == null ? null : seen.toString());
            m.put("minutes", r[5] == null ? 0 : Math.round(((Number) r[5]).doubleValue() / 6000.0) / 10.0);
            m.put("visits", r[6] == null ? 0 : ((Number) r[6]).longValue());
            m.put("percent", r[7] == null ? null : Math.round(((Number) r[7]).doubleValue()));
            recent.add(m);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        Instant lastSeen = recent.isEmpty() || recent.get(0).get("last_seen_at") == null ? null
                : Instant.parse((String) recent.get(0).get("last_seen_at"));
        Long ago = lastSeen == null ? null : Math.max(0, now.getEpochSecond() - lastSeen.getEpochSecond());
        String state = ago == null ? "NEVER"
                : ago <= activeWindowSeconds ? "ACTIVE"
                : ago <= offlineWindowSeconds ? "IDLE"
                : "OFFLINE";
        out.put("state", state);
        out.put("last_seen_at", lastSeen == null ? null : lastSeen.toString());
        out.put("last_seen_ago_seconds", ago);
        out.put("current", "ACTIVE".equals(state) || "IDLE".equals(state) ? recent.get(0) : null);
        out.put("recent", recent);
        return out;
    }

    private static String str(Object o) {
        return o == null ? null : o.toString();
    }

    private static Instant instant(Object o) {
        if (o == null) return null;
        if (o instanceof Instant i) return i;
        if (o instanceof Timestamp t) return t.toInstant();
        if (o instanceof OffsetDateTime odt) return odt.toInstant();
        try {
            return Instant.parse(o.toString());
        } catch (Exception e) {
            return null;
        }
    }
}
