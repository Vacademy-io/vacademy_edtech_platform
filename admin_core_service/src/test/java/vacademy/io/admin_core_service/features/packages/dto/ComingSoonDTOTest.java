package vacademy.io.admin_core_service.features.packages.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ComingSoonDTOTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("Enabled COMING_SOON maps only the whitelisted fields")
    void enabledSettingIsMapped() {
        String json = """
                {"setting":{
                  "LMS_SETTING":{"key":"LMS_SETTING","data":{"apiKey":"secret"}},
                  "COMING_SOON":{"key":"COMING_SOON","name":"Coming Soon","data":{
                    "enabled":true,"launchDate":"2026-11-15","ribbonText":"  ",
                    "buttonText":"Join waitlist","audienceId":"aud-1","notifiedAt":"x"}}}}
                """;

        ComingSoonDTO dto = ComingSoonDTO.fromCourseSetting(json, objectMapper);

        assertNotNull(dto);
        assertTrue(dto.getEnabled());
        assertEquals("2026-11-15", dto.getLaunchDate());
        assertNull(dto.getRibbonText(), "blank text is dropped");
        assertEquals("Join waitlist", dto.getButtonText());
        assertEquals("aud-1", dto.getAudienceId());
    }

    @Test
    @DisplayName("Off, absent, empty or unreadable settings are all null — never an exception")
    void anythingElseIsNull() {
        assertNull(ComingSoonDTO.fromCourseSetting(null, objectMapper));
        assertNull(ComingSoonDTO.fromCourseSetting("", objectMapper));
        assertNull(ComingSoonDTO.fromCourseSetting("{\"setting\":{}}", objectMapper));
        assertNull(ComingSoonDTO.fromCourseSetting(
                "{\"setting\":{\"COMING_SOON\":{\"data\":{\"enabled\":false,\"audienceId\":\"a\"}}}}", objectMapper));
        // The open catalogue selects course_setting whenever it merely MENTIONS COMING_SOON.
        assertNull(ComingSoonDTO.fromCourseSetting("{not json COMING_SOON", objectMapper));
    }
}
