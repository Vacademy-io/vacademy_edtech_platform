package vacademy.io.admin_core_service.features.points_ledger.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.dto.settings.InstituteSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.SettingDto;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;

import java.util.Map;

/**
 * The institute's "points per action" scoring, from BADGES_REWARDS_SETTING.scoring
 * (Settings → Badges & Rewards).
 *
 * These numbers already existed and were read ONLY by the learner's browser to
 * render an XP figure the server never saw. Reading them here is what lets the
 * same configured values drive a real, comparable, server-side total.
 *
 * Defaults mirror DEFAULT_SCORING in the learner app's badge-config.ts — keep them
 * in lock-step, or an institute that never opened the settings screen would see its
 * points change the day this started running.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ScoringConfigService {

    public static final String SETTING_KEY = "BADGES_REWARDS_SETTING";

    public static final int DEFAULT_ACTIVITY_PER_DAY = 10;
    public static final int DEFAULT_STREAK_PER_DAY = 5;

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    /** Whether the institute has badges/leaderboard switched on at all (defaults OFF). */
    public boolean isEnabled(String instituteId) {
        Map<?, ?> data = settingData(instituteId);
        return data != null && Boolean.TRUE.equals(data.get("enabled"));
    }

    public int getActivityPerDay(String instituteId) {
        return scoringInt(instituteId, "activityPerDay", DEFAULT_ACTIVITY_PER_DAY);
    }

    public int getStreakPerDay(String instituteId) {
        return scoringInt(instituteId, "streakPerDay", DEFAULT_STREAK_PER_DAY);
    }

    private int scoringInt(String instituteId, String key, int fallback) {
        Map<?, ?> data = settingData(instituteId);
        if (data == null) return fallback;
        Object scoring = data.get("scoring");
        if (!(scoring instanceof Map)) return fallback;
        Object raw = ((Map<?, ?>) scoring).get(key);
        if (raw == null) return fallback;
        try {
            int value = (raw instanceof Number n) ? n.intValue() : Integer.parseInt(raw.toString());
            // A negative award would mean points_ledger rows that silently subtract.
            return Math.max(0, value);
        } catch (Exception e) {
            return fallback;
        }
    }

    private Map<?, ?> settingData(String instituteId) {
        try {
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null || institute.getSetting() == null) return null;
            InstituteSettingDto settingDto =
                    objectMapper.readValue(institute.getSetting(), InstituteSettingDto.class);
            Map<String, SettingDto> settings = settingDto.getSetting();
            if (settings == null) return null;
            SettingDto s = settings.get(SETTING_KEY);
            if (s == null || !(s.getData() instanceof Map)) return null;
            return (Map<?, ?>) s.getData();
        } catch (Exception e) {
            return null;
        }
    }
}
