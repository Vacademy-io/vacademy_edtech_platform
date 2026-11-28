package vacademy.io.admin_core_service.features.enrolment_break.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The institute's breaks-and-holds settings, {@code setting.ENROLMENT_BREAK_SETTING.data} in the
 * institute setting JSON, saved through the generic institute setting endpoint from Settings →
 * Breaks and holds. Read through a one-minute cache.
 * <ul>
 *   <li>{@code enabled}: the on/off switch. Off when absent.</li>
 *   <li>{@code keep_dates_after_days}: when a pause has lasted longer than this many days, resuming
 *       keeps the membership's dates by default instead of moving them by the paused days (staff
 *       can still choose otherwise). Absent = always move by the paused days, as before.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EnrolmentBreakSettings {

    public static final String SETTING_KEY = "ENROLMENT_BREAK_SETTING";
    private static final long TTL_MS = 60_000L;

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    private record Cached(boolean enabled, Integer keepDatesAfterDays, long at) {}

    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    public boolean isEnabled(String instituteId) {
        Cached c = cached(instituteId);
        return c != null && c.enabled();
    }

    /** The paused-days threshold after which resuming keeps the dates by default; null = never. */
    public Integer keepDatesAfterDays(String instituteId) {
        Cached c = cached(instituteId);
        return c == null ? null : c.keepDatesAfterDays();
    }

    /**
     * The resume choice to use when staff make none (and for a pause that ends on its planned
     * date): keep the dates after a long pause if the institute says so, else move them.
     */
    public String defaultResumeMode(String instituteId, int pausedDays) {
        Integer after = keepDatesAfterDays(instituteId);
        return after != null && pausedDays > after ? "KEEP_DATES" : "SHIFT_BY_PAUSED_DAYS";
    }

    private Cached cached(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return null;
        Cached c = cache.get(instituteId);
        if (c != null && System.currentTimeMillis() - c.at() < TTL_MS) return c;
        Cached fresh = read(instituteId);
        cache.put(instituteId, fresh);
        return fresh;
    }

    public void forget(String instituteId) {
        if (instituteId != null) cache.remove(instituteId);
    }

    private Cached read(String instituteId) {
        long now = System.currentTimeMillis();
        try {
            String json = instituteRepository.findById(instituteId)
                    .map(vacademy.io.common.institute.entity.Institute::getSetting)
                    .orElse(null);
            if (json == null || json.isBlank()) return new Cached(false, null, now);
            var data = objectMapper.readTree(json).path("setting").path(SETTING_KEY).path("data");
            var after = data.path("keep_dates_after_days");
            Integer days = after.canConvertToInt() && after.asInt() > 0 ? after.asInt() : null;
            return new Cached(data.path("enabled").asBoolean(false), days, now);
        } catch (Exception e) {
            log.warn("[enrolment-break] could not read setting for {}: {}", instituteId, e.getMessage());
            return new Cached(false, null, now);
        }
    }
}
