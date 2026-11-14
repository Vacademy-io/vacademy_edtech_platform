package vacademy.io.admin_core_service.features.institute.service.setting;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateSettingRequest;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The settings UI only ever sends COURSE_COMPLETION. Other kinds of certificate — the partner
 * Certificate of Affiliation lives as a SUB_ORG_AFFILIATION sibling entry — must survive that
 * save, and the course entry must stay first (the UI reads data[0]).
 */
class CertificateSettingStrategyPreserveEntriesTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void savingOnlyTheCourseEntryKeepsTheAffiliationEntryAndItsOrder() throws Exception {
        Institute institute = new Institute();
        institute.setId("inst-1");
        institute.setSetting("""
                {"institute_id":"inst-1","setting":{"CERTIFICATE_SETTING":{"key":"CERTIFICATE_SETTING","name":"Certificate Setting",
                 "data":{"data":[
                   {"key":"COURSE_COMPLETION","isDefaultCertificateSettingOn":false,"currentHtmlCertificateTemplate":"<p>old</p>"},
                   {"key":"SUB_ORG_AFFILIATION","isDefaultCertificateSettingOn":true,"aspectRatio":"A4_PORTRAIT",
                    "currentHtmlCertificateTemplate":"<p>affiliation</p>",
                    "certificateNumbering":{"pattern":"{PREFIX}/VLE/{YYYY}/{SEQ:4}","prefix":"IDEED"}}
                 ]}}}}
                """);

        CertificateSettingDto course = new CertificateSettingDto();
        course.setKey("COURSE_COMPLETION");
        course.setIsDefaultCertificateSettingOn(true);
        course.setCurrentHtmlCertificateTemplate("<p>new</p>");
        CertificateSettingRequest request = new CertificateSettingRequest();
        request.getRequest().put("COURSE_COMPLETION", course);

        String saved;
        try {
            saved = new CertificateSettingStrategy().buildInstituteSetting(institute, request);
        } catch (RuntimeException e) {
            throw new AssertionError("strategy threw: " + e.getMessage(), e);
        }
        JsonNode entries = MAPPER.readTree(saved).path("setting").path("CERTIFICATE_SETTING").path("data").path("data");

        List<String> keys = new ArrayList<>();
        entries.forEach(e -> keys.add(e.path("key").asText()));
        assertEquals(List.of("COURSE_COMPLETION", "SUB_ORG_AFFILIATION"), keys, "sibling entry kept, course entry first");
        assertEquals("<p>new</p>", entries.get(0).path("currentHtmlCertificateTemplate").asText(), "course entry updated");
        assertTrue(entries.get(0).path("isDefaultCertificateSettingOn").asBoolean());
        assertEquals("<p>affiliation</p>", entries.get(1).path("currentHtmlCertificateTemplate").asText(), "affiliation untouched");
        assertEquals("{PREFIX}/VLE/{YYYY}/{SEQ:4}",
                entries.get(1).path("certificateNumbering").path("pattern").asText(), "its numbering untouched");
    }
}
