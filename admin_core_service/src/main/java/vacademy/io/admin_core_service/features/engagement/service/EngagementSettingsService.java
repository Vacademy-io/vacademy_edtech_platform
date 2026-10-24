package vacademy.io.admin_core_service.features.engagement.service;

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
 * Institute-level knobs for daily engagement, stored under the ENGAGEMENT_SETTING
 * institute setting. Every value has a working default so the feature behaves
 * sensibly for an institute that never opens the settings screen.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EngagementSettingsService {

    public static final String SETTING_KEY = "ENGAGEMENT_SETTING";

    /**
     * How many items a learner is shown per day ACROSS ALL their batches. A learner
     * in four batches would otherwise face a dozen tasks on a Monday and bounce.
     */
    public static final int DEFAULT_DAILY_ITEM_CAP = 5;

    /** Reading completion needs this much scroll depth to count. */
    public static final int DEFAULT_MIN_SCROLL_PERCENT = 80;

    /** Reading completion also needs this much dwell time. */
    public static final long DEFAULT_MIN_READ_MS = 15_000L;

    /**
     * A game pays out only after this much server-measured time since the learner
     * opened it. "Mark complete" used to pay the moment the dialog opened.
     */
    public static final long DEFAULT_MIN_GAME_MS = 20_000L;

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    public int getDailyItemCap(String instituteId) {
        return intSetting(instituteId, "dailyItemCap", DEFAULT_DAILY_ITEM_CAP, 1, 50);
    }

    public int getMinScrollPercent(String instituteId) {
        return intSetting(instituteId, "minScrollPercent", DEFAULT_MIN_SCROLL_PERCENT, 0, 100);
    }

    public long getMinReadMs(String instituteId) {
        return intSetting(instituteId, "minReadSeconds",
                (int) (DEFAULT_MIN_READ_MS / 1000), 0, 3600) * 1000L;
    }

    public long getMinGameMs(String instituteId) {
        return intSetting(instituteId, "minGameSeconds",
                (int) (DEFAULT_MIN_GAME_MS / 1000), 0, 3600) * 1000L;
    }

    /**
     * Whether a self-reported score may earn score-proportional points on top of
     * completion points. OFF by default: a teacher-uploaded game's score is whatever
     * the page chose to post, so letting it scale points hands the leaderboard to
     * anyone willing to open devtools.
     */
    public boolean isUnverifiedScoreBonusEnabled(String instituteId) {
        Map<?, ?> data = settingData(instituteId);
        return data != null && Boolean.TRUE.equals(data.get("allowUnverifiedScoreBonus"));
    }

    /**
     * Every learner-facing knob from ONE read of the institute row.
     *
     * The getters above each re-read and re-parse the institute's settings JSON; the feed
     * needs all of them for every item, so it takes a snapshot once per request instead.
     */
    public Snapshot snapshot(String instituteId) {
        Map<?, ?> data = settingData(instituteId);
        return new Snapshot(
                intFrom(data, "dailyItemCap", DEFAULT_DAILY_ITEM_CAP, 1, 50),
                intFrom(data, "minScrollPercent", DEFAULT_MIN_SCROLL_PERCENT, 0, 100),
                intFrom(data, "minReadSeconds", (int) (DEFAULT_MIN_READ_MS / 1000), 0, 3600) * 1000L,
                intFrom(data, "minGameSeconds", (int) (DEFAULT_MIN_GAME_MS / 1000), 0, 3600) * 1000L,
                data != null && Boolean.TRUE.equals(data.get("allowUnverifiedScoreBonus")));
    }

    /** The resolved engagement settings of one institute; every value has its default applied. */
    public record Snapshot(int dailyItemCap, int minScrollPercent, long minReadMs, long minGameMs,
                           boolean unverifiedScoreBonusEnabled) {
        /** All defaults: what an institute that never opened the settings screen gets. */
        public static Snapshot defaults() {
            return new Snapshot(DEFAULT_DAILY_ITEM_CAP, DEFAULT_MIN_SCROLL_PERCENT,
                    DEFAULT_MIN_READ_MS, DEFAULT_MIN_GAME_MS, false);
        }
    }

    private int intSetting(String instituteId, String key, int fallback, int min, int max) {
        return intFrom(settingData(instituteId), key, fallback, min, max);
    }

    private static int intFrom(Map<?, ?> data, String key, int fallback, int min, int max) {
        if (data == null) return fallback;
        Object raw = data.get(key);
        if (raw == null) return fallback;
        try {
            int value = (raw instanceof Number n) ? n.intValue() : Integer.parseInt(raw.toString());
            return Math.max(min, Math.min(max, value));
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
