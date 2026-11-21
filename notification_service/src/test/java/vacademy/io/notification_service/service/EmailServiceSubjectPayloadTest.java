package vacademy.io.notification_service.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Writer side of the outbound-subject contract: EmailService stores the subject under
 * {@link EmailService#SUBJECT_PAYLOAD_KEY} in message_payload, and the inbox reader
 * (EmailInboxService / EmailThreadMerger) looks it up by the same constant. Renaming the key
 * on one side must fail here, not silently strip every subject from the thread view.
 */
class EmailServiceSubjectPayloadTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("subject is stored as {\"subject\": ...} — the key the inbox reads")
    void storesSubjectUnderTheSharedKey() throws Exception {
        String json = EmailService.subjectPayload(objectMapper, "Batch starts Monday");

        assertThat(EmailService.SUBJECT_PAYLOAD_KEY).isEqualTo("subject");
        assertThat(objectMapper.readTree(json).get(EmailService.SUBJECT_PAYLOAD_KEY).asText())
                .isEqualTo("Batch starts Monday");
        assertThat(objectMapper.readTree(json).size()).isEqualTo(1);
    }

    @Test
    void blankSubjectStoresNothing() {
        assertThat(EmailService.subjectPayload(objectMapper, null)).isNull();
        assertThat(EmailService.subjectPayload(objectMapper, "   ")).isNull();
    }

    @Test
    void subjectWithQuotesAndUnicodeRoundTrips() throws Exception {
        String subject = "Re: \"hello\" — नमस्ते <Batch A>";
        String json = EmailService.subjectPayload(objectMapper, subject);

        assertThat(objectMapper.readTree(json).get("subject").asText()).isEqualTo(subject);
    }

    @Test
    @DisplayName("template name and sender sit beside the subject, under the keys the timeline reads")
    void storesTemplateAndOriginBesideSubject() throws Exception {
        String json = EmailService.logPayload(objectMapper, "Welcome", Map.of(
                EmailService.TEMPLATE_NAME_PAYLOAD_KEY, "VTC welcome email",
                "originType", "ADMIN_RESEND",
                "originId", "admin-7",
                "originName", "Sarita R"));

        var node = objectMapper.readTree(json);
        assertThat(node.get("subject").asText()).isEqualTo("Welcome");
        assertThat(node.get("templateName").asText()).isEqualTo("VTC welcome email");
        assertThat(node.get("originType").asText()).isEqualTo("ADMIN_RESEND");
        assertThat(node.get("originName").asText()).isEqualTo("Sarita R");
    }

    @Test
    @DisplayName("blank extras are dropped and cannot replace the subject")
    void blankExtrasDroppedAndSubjectKept() throws Exception {
        Map<String, String> meta = new HashMap<>();
        meta.put("templateName", "  ");
        meta.put("originName", null);
        meta.put("subject", "spoofed");

        String json = EmailService.logPayload(objectMapper, "Real subject", meta);

        var node = objectMapper.readTree(json);
        assertThat(node.size()).isEqualTo(1);
        assertThat(node.get("subject").asText()).isEqualTo("Real subject");
    }

    @Test
    void templateWithoutSubjectStillStored() throws Exception {
        String json = EmailService.logPayload(objectMapper, null, Map.of("templateName", "T1"));
        assertThat(objectMapper.readTree(json).get("templateName").asText()).isEqualTo("T1");
    }
}
