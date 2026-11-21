package vacademy.io.admin_core_service.features.classroom.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Reads CLASSROOM_NOTIFY_SETTING out of {@code institutes.setting_json}.
 *
 * One LIKE scan per hourly tick, the same approach as
 * REPORT_SETTING. Only institutes that switched a channel on come back, so on a
 * platform where nobody has opted in the job ends here without calling any other
 * service. Each institute's blob is parsed on its own: one bad blob skips that
 * institute, never the tick.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class ClassroomNotifySettingReader {

    private static final String SQL =
            "SELECT id, name, institute_theme_code, country, setting_json FROM institutes "
                    + "WHERE setting_json LIKE '%" + ClassroomNotifySetting.SETTING_KEY + "%'";

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    /** An institute that opted in to at least one channel. country decides the default phone prefix. */
    public record OptedIn(String instituteId, String instituteName, String themeCode,
                          ClassroomNotifySetting setting, String country) {
    }

    public List<OptedIn> loadOptedIn() {
        List<OptedIn> out = new ArrayList<>();
        jdbcTemplate.query(SQL, rs -> {
            String id = rs.getString("id");
            String json = rs.getString("setting_json");
            OptedIn row = parse(id, rs.getString("name"), rs.getString("institute_theme_code"),
                    rs.getString("country"), json);
            if (row != null) out.add(row);
        });
        return out;
    }

    OptedIn parse(String instituteId, String name, String themeCode, String country, String settingJson) {
        if (instituteId == null || settingJson == null || settingJson.isBlank()) return null;
        try {
            JsonNode data = objectMapper.readTree(settingJson)
                    .path("setting")
                    .path(ClassroomNotifySetting.SETTING_KEY)
                    .path("data");
            if (data.isMissingNode() || data.isNull()) return null;
            ClassroomNotifySetting setting = ClassroomNotifySetting.from(data);
            if (!setting.anyChannelOn()) return null;
            return new OptedIn(instituteId, name, themeCode, setting, country);
        } catch (Exception e) {
            log.warn("[classroom] could not parse {} for institute {}; skipping it",
                    ClassroomNotifySetting.SETTING_KEY, instituteId);
            return null;
        }
    }
}
