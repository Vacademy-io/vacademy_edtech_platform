package vacademy.io.admin_core_service.features.packages.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.util.StringUtils;

/**
 * Public view of a course's "Coming Soon" state, read from
 * {@code package.course_setting -> setting.COMING_SOON.data}.
 *
 * <p>While enabled the catalogue shows the course with a ribbon and a "Notify me" button instead
 * of enrol/buy, and the button collects a lead into {@code audienceId}. Only these fields are ever
 * sent to the public catalogue — the rest of course_setting holds LMS connection secrets.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ComingSoonDTO {

    public static final String SETTING_KEY = "COMING_SOON";

    private Boolean enabled;
    /** Optional, {@code yyyy-MM-dd}. Display only — going live is always the admin's switch. */
    private String launchDate;
    private String ribbonText;
    private String buttonText;
    private String audienceId;

    /**
     * Parses a raw course_setting blob. Returns null when the setting is absent, switched off or
     * unreadable — a broken blob must never break the public catalogue.
     */
    public static ComingSoonDTO fromCourseSetting(String courseSettingJson, ObjectMapper objectMapper) {
        if (!StringUtils.hasText(courseSettingJson)) {
            return null;
        }
        try {
            JsonNode data = objectMapper.readTree(courseSettingJson)
                    .path("setting").path(SETTING_KEY).path("data");
            if (!data.path("enabled").asBoolean(false)) {
                return null;
            }
            return ComingSoonDTO.builder()
                    .enabled(true)
                    .launchDate(textOrNull(data, "launchDate"))
                    .ribbonText(textOrNull(data, "ribbonText"))
                    .buttonText(textOrNull(data, "buttonText"))
                    .audienceId(textOrNull(data, "audienceId"))
                    .build();
        } catch (Exception e) {
            return null;
        }
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isTextual() && StringUtils.hasText(value.asText()) ? value.asText().trim() : null;
    }
}
