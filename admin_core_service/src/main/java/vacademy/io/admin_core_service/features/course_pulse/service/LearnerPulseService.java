package vacademy.io.admin_core_service.features.course_pulse.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.course_pulse.repository.PulseRepository;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;

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
    private final InstituteTimezoneService instituteTimezoneService;

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

    /**
     * The last 30 days in numbers: totals, this week against the week before, time by content
     * type and by local weekday and hour. Each part fails on its own and is left empty.
     */
    public Map<String, Object> learnerInsights(String userId, String instituteId) {
        Instant now = Instant.now();
        String zone = instituteTimezoneService.getZone(instituteId).getId();
        Timestamp since = Timestamp.from(now.minus(RECENT_DAYS, ChronoUnit.DAYS));
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            List<Object[]> rows = pulseRepository.getLearnerTotals(userId, zone, since,
                    Timestamp.from(now.minus(7, ChronoUnit.DAYS)), Timestamp.from(now.minus(14, ChronoUnit.DAYS)));
            if (!rows.isEmpty()) {
                Object[] r = rows.get(0);
                out.put("total_minutes", minutes(r[0]));
                out.put("active_days", number(r[1]));
                out.put("slides_opened", number(r[2]));
                out.put("visits", number(r[3]));
                out.put("week_minutes", minutes(r[4]));
                out.put("previous_week_minutes", minutes(r[5]));
            }
        } catch (Exception e) {
            log.warn("[LearnerPulse] totals failed for user={}: {}", userId, e.getMessage());
        }
        List<Map<String, Object>> mix = new ArrayList<>();
        try {
            for (Object[] r : pulseRepository.getLearnerContentMix(userId, since)) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("type", str(r[0]));
                m.put("minutes", minutes(r[1]));
                m.put("slides", number(r[2]));
                mix.add(m);
            }
        } catch (Exception e) {
            log.warn("[LearnerPulse] content mix failed for user={}: {}", userId, e.getMessage());
        }
        out.put("content_mix", mix);
        List<Map<String, Object>> rhythm = new ArrayList<>();
        try {
            for (Object[] r : pulseRepository.getLearnerRhythm(userId, zone, since)) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("weekday", number(r[0]));
                m.put("hour", number(r[1]));
                m.put("minutes", minutes(r[2]));
                rhythm.add(m);
            }
        } catch (Exception e) {
            log.warn("[LearnerPulse] rhythm failed for user={}: {}", userId, e.getMessage());
        }
        out.put("rhythm", rhythm);
        return out;
    }

    private static long number(Object o) {
        return o == null ? 0 : ((Number) o).longValue();
    }

    private static double minutes(Object ms) {
        return ms == null ? 0 : Math.round(((Number) ms).doubleValue() / 6000.0) / 10.0;
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
