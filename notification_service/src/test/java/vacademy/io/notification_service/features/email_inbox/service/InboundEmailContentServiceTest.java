package vacademy.io.notification_service.features.email_inbox.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class InboundEmailContentServiceTest {

    private final InboundEmailContentService service =
            new InboundEmailContentService(null, null, new ObjectMapper());

    @Test
    void cidImagesBecomeDataUris() throws Exception {
        MimeMessage msg = InboundMimePartsTest.sampleMessage();
        String html = service.inlineCidImages("<img src=\"cid:logo@x\"><img src=\"cid:missing@x\">", msg);
        assertThat(html).contains("src=\"data:image/png;base64,");
        // An unknown cid stays as it was rather than becoming an empty src.
        assertThat(html).contains("src=\"cid:missing@x\"");
    }

    @Test
    void htmlWithoutCidIsUntouched() throws Exception {
        String html = "<p>No images</p>";
        assertThat(service.inlineCidImages(html, InboundMimePartsTest.sampleMessage())).isSameAs(html);
    }
}
