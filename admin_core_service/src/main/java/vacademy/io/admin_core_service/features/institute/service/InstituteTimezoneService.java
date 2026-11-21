package vacademy.io.admin_core_service.features.institute.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.dto.settings.InstituteSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.SettingDto;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;

import java.time.ZoneId;
import java.util.Map;

/**
 * Resolves an institute's IANA timezone from the LANGUAGE_SETTING institute setting
 * (Settings -> Language -> "Institute timezone"), which is where the portal already
 * stores it.
 *
 * Every daily-engagement window is authored in institute-local wall-clock time, so
 * this is the single place that decides what "today" and "6 AM" mean for a batch.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class InstituteTimezoneService {

    public static final ZoneId DEFAULT_ZONE = ZoneId.of("Asia/Kolkata");

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    /** The institute's zone, or {@link #DEFAULT_ZONE} when unset/unparseable. */
    public ZoneId getZone(String instituteId) {
        return safeZone(getTimezoneId(instituteId));
    }

    /** The raw IANA string as configured, or "Asia/Kolkata" when unset. */
    public String getTimezoneId(String instituteId) {
        try {
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null || institute.getSetting() == null) return DEFAULT_ZONE.getId();
            InstituteSettingDto settingDto =
                    objectMapper.readValue(institute.getSetting(), InstituteSettingDto.class);
            Map<String, SettingDto> settings = settingDto.getSetting();
            if (settings == null) return DEFAULT_ZONE.getId();
            SettingDto language = settings.get("LANGUAGE_SETTING");
            if (language == null || !(language.getData() instanceof Map)) return DEFAULT_ZONE.getId();
            Object tz = ((Map<?, ?>) language.getData()).get("timezone");
            if (tz == null || tz.toString().isBlank()) return DEFAULT_ZONE.getId();
            return tz.toString();
        } catch (Exception e) {
            log.warn("[institute-tz] falling back to default for institute {}: {}", instituteId, e.getMessage());
            return DEFAULT_ZONE.getId();
        }
    }

    /** Never throws — an institute with a bad zone string must not break scheduling. */
    public static ZoneId safeZone(String tz) {
        try {
            return (tz == null || tz.isBlank()) ? DEFAULT_ZONE : ZoneId.of(tz);
        } catch (Exception e) {
            return DEFAULT_ZONE;
        }
    }
}
