package vacademy.io.admin_core_service.features.enrolment_break.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The institute's on/off switch for breaks and holds: {@code setting.ENROLMENT_BREAK_SETTING.data.enabled}
 * in the institute setting JSON, saved through the generic institute setting endpoint from
 * Settings → Breaks and holds. Off when absent. Read through a one-minute cache.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EnrolmentBreakSettings {

    public static final String SETTING_KEY = "ENROLMENT_BREAK_SETTING";
    private static final long TTL_MS = 60_000L;

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    private record Cached(boolean enabled, long at) {}

    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    public boolean isEnabled(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return false;
        Cached c = cache.get(instituteId);
        if (c != null && System.currentTimeMillis() - c.at() < TTL_MS) return c.enabled();
        boolean enabled = read(instituteId);
        cache.put(instituteId, new Cached(enabled, System.currentTimeMillis()));
        return enabled;
    }

    public void forget(String instituteId) {
        if (instituteId != null) cache.remove(instituteId);
    }

    private boolean read(String instituteId) {
        try {
            String json = instituteRepository.findById(instituteId)
                    .map(vacademy.io.common.institute.entity.Institute::getSetting)
                    .orElse(null);
            if (json == null || json.isBlank()) return false;
            return objectMapper.readTree(json).path("setting").path(SETTING_KEY)
                    .path("data").path("enabled").asBoolean(false);
        } catch (Exception e) {
            log.warn("[enrolment-break] could not read setting for {}: {}", instituteId, e.getMessage());
            return false;
        }
    }
}
