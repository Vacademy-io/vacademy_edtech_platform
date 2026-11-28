package vacademy.io.admin_core_service.features.one_off_due.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The institute switch for one-off charges, {@code setting.ONE_OFF_DUE_SETTING.data.enabled} in
 * the institute setting JSON, saved through the generic institute setting endpoint from
 * Settings → One-off charges. Off when absent. Read through a one-minute cache.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OneOffDueSettings {

    public static final String SETTING_KEY = "ONE_OFF_DUE_SETTING";
    private static final long TTL_MS = 60_000L;

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    private record Cached(boolean enabled, long at) {}

    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    public boolean isEnabled(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return false;
        Cached c = cache.get(instituteId);
        if (c != null && System.currentTimeMillis() - c.at() < TTL_MS) return c.enabled();
        Cached fresh = new Cached(read(instituteId), System.currentTimeMillis());
        cache.put(instituteId, fresh);
        return fresh.enabled();
    }

    private boolean read(String instituteId) {
        try {
            String json = instituteRepository.findById(instituteId)
                    .map(vacademy.io.common.institute.entity.Institute::getSetting)
                    .orElse(null);
            if (json == null || json.isBlank()) return false;
            return objectMapper.readTree(json).path("setting").path(SETTING_KEY).path("data")
                    .path("enabled").asBoolean(false);
        } catch (Exception e) {
            log.warn("[one-off-due] could not read setting for {}: {}", instituteId, e.getMessage());
            return false;
        }
    }
}
