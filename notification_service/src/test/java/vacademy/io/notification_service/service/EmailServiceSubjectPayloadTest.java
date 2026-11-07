package vacademy.io.notification_service.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

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
}
