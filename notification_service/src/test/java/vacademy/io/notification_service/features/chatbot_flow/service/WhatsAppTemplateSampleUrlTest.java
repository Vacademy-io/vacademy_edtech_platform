package vacademy.io.notification_service.features.chatbot_flow.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A header sample uploaded as "image (19).png" is stored as "image_%2819%29.png". Submit downloads
 * it before handing it to Meta, and the String overload of RestTemplate encoded it a second time
 * ("%2528"), so the CDN answered 403 and the admin was told the URL was not public.
 */
class WhatsAppTemplateSampleUrlTest {

    private static final String UPLOADED =
            "https://cdn.example.com/WHATSAPP_TEMPLATE_MEDIA/inst-1/d8e52cc5-image_%2819%29.png";

    @Test
    @DisplayName("an already-encoded uploaded URL is requested exactly as stored")
    void encodedUrlIsNotEncodedAgain() {
        assertThat(WhatsAppTemplateManagerService.toRequestUri(UPLOADED).toString()).isEqualTo(UPLOADED);
    }

    @Test
    @DisplayName("a plain URL passes through unchanged")
    void plainUrlUnchanged() {
        String url = "https://example.com/media/banner.jpg?v=2";
        assertThat(WhatsAppTemplateManagerService.toRequestUri(url).toString()).isEqualTo(url);
    }

    @Test
    @DisplayName("a pasted URL with a raw space is encoded once")
    void rawSpaceIsEncodedOnce() {
        assertThat(WhatsAppTemplateManagerService.toRequestUri(" https://example.com/my banner.jpg ").toString())
                .isEqualTo("https://example.com/my%20banner.jpg");
    }

    @Test
    @DisplayName("the upload-session file name is reduced to characters that need no encoding")
    void fileNameIsCleaned() {
        assertThat(WhatsAppTemplateManagerService.extractFileName(UPLOADED, "IMAGE"))
                .isEqualTo("d8e52cc5-image__19_.png");
        assertThat(WhatsAppTemplateManagerService.extractFileName("https://example.com/", "VIDEO"))
                .isEqualTo("sample-video");
    }
}
