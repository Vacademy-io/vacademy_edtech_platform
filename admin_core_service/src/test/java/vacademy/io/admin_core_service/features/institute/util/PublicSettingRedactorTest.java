package vacademy.io.admin_core_service.features.institute.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class PublicSettingRedactorTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void blanksProviderCredentialsButKeepsConfiguration() throws Exception {
        String raw = """
                {"institute_id":"i1","setting":{
                  "EMAIL_SETTING":{"key":"EMAIL_SETTING","data":{"UTILITY_EMAIL":{"host":"smtp.x","username":"u","password":"p@ss"}}},
                  "WHATSAPP_SETTING":{"data":{"UTILITY_WHATSAPP":{"wati":{"apiKey":"k-123","api_url":"https://w"}}}},
                  "LMS_SETTING":{"data":{"moodle":{"wstoken":"t1","refresh_token":"r1","client_secret":"s1","applicationPassword":"a1"}}},
                  "STUDENT_DISPLAY_SETTINGS":{"data":{"signup":{"passwordStrategy":"AUTO","passwordDelivery":"EMAIL"},"allowViewPassword":true}},
                  "NAMING_SETTING":{"data":[{"key":"Course","customValue":"Program"}]}
                }}""";

        JsonNode out = mapper.readTree(PublicSettingRedactor.redact(raw));
        JsonNode s = out.get("setting");

        assertEquals("", s.at("/EMAIL_SETTING/data/UTILITY_EMAIL/password").asText());
        assertEquals("smtp.x", s.at("/EMAIL_SETTING/data/UTILITY_EMAIL/host").asText());
        assertEquals("u", s.at("/EMAIL_SETTING/data/UTILITY_EMAIL/username").asText());
        assertEquals("", s.at("/WHATSAPP_SETTING/data/UTILITY_WHATSAPP/wati/apiKey").asText());
        assertEquals("https://w", s.at("/WHATSAPP_SETTING/data/UTILITY_WHATSAPP/wati/api_url").asText());
        assertEquals("", s.at("/LMS_SETTING/data/moodle/wstoken").asText());
        assertEquals("", s.at("/LMS_SETTING/data/moodle/refresh_token").asText());
        assertEquals("", s.at("/LMS_SETTING/data/moodle/client_secret").asText());
        assertEquals("", s.at("/LMS_SETTING/data/moodle/applicationPassword").asText());

        assertEquals("AUTO", s.at("/STUDENT_DISPLAY_SETTINGS/data/signup/passwordStrategy").asText());
        assertEquals("EMAIL", s.at("/STUDENT_DISPLAY_SETTINGS/data/signup/passwordDelivery").asText());
        assertTrue(s.at("/STUDENT_DISPLAY_SETTINGS/data/allowViewPassword").asBoolean());
        assertEquals("Program", s.at("/NAMING_SETTING/data/0/customValue").asText());
        assertEquals("i1", out.get("institute_id").asText());
    }

    @Test
    void blankInputPassesThroughAndGarbageNeverLeaksRaw() {
        assertNull(PublicSettingRedactor.redact(null));
        assertEquals("", PublicSettingRedactor.redact(""));
        assertNull(PublicSettingRedactor.redact("{not json \"password\":\"x\""));
    }
}
