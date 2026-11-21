package vacademy.io.notification_service.features.email_inbox.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.email_inbox.dto.EmailAttachmentDTO;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class EmailInboxAttachmentsTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void readsTheIndexIngestWrote() throws Exception {
        JsonNode payload = mapper.readTree("""
                {"subject":"RFQ","attachments":[
                  {"id":"2","filename":"RFQ.pdf","contentType":"application/pdf","size":346189,"inline":false},
                  {"id":"1.2.2","filename":"logo.png","contentType":"image/png","size":10,"inline":true,"contentId":"logo@x"},
                  {"filename":"no-id.bin"}
                ],"hasHtml":true}""");

        List<EmailAttachmentDTO> list = EmailInboxService.attachmentsOf(Optional.of(payload));

        assertThat(list).extracting(EmailAttachmentDTO::getId).containsExactly("2", "1.2.2");
        assertThat(list.get(0).getFilename()).isEqualTo("RFQ.pdf");
        assertThat(list.get(0).getSize()).isEqualTo(346189);
        assertThat(list.get(0).isInline()).isFalse();
        assertThat(list.get(1).isInline()).isTrue();
    }

    @Test
    void unindexedRowsHaveNoAttachments() throws Exception {
        assertThat(EmailInboxService.attachmentsOf(Optional.of(mapper.readTree("{\"body\":\"hi\"}")))).isEmpty();
        assertThat(EmailInboxService.attachmentsOf(Optional.empty())).isEmpty();
    }
}
