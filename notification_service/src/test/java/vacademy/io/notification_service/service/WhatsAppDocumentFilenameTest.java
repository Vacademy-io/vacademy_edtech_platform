package vacademy.io.notification_service.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The filename on a document template header is what the recipient sees in WhatsApp, so it should
 * be the uploaded file's own name rather than a placeholder.
 */
class WhatsAppDocumentFilenameTest {

    @Test
    @DisplayName("strips the upload key's uuid prefix and keeps the original name")
    void stripsUuidPrefix() {
        assertThat(WhatsAppService.documentFilenameFromUrl(
                "https://d1om4dxj9e7kkd.cloudfront.net/ADMIN_PUBLIC_UPLOAD/63a5262b-f5e4-4de6-990e-d3296ca5012b-HCCA_Updated_Brochure_1.pdf"))
                .isEqualTo("HCCA_Updated_Brochure_1.pdf");
    }

    @Test
    @DisplayName("decodes %-escapes and ignores query strings")
    void decodesAndIgnoresQuery() {
        assertThat(WhatsAppService.documentFilenameFromUrl(
                "https://cdn.example.com/files/HCCA%20Syllabus%201.pdf?X-Amz-Expires=3600"))
                .isEqualTo("HCCA Syllabus 1.pdf");
    }

    @Test
    @DisplayName("a literal '+' in the name survives decoding, and an encoded slash cannot smuggle a path")
    void plusAndEncodedSlash() {
        assertThat(WhatsAppService.documentFilenameFromUrl("https://cdn.example.com/files/C++_Notes.pdf"))
                .isEqualTo("C++_Notes.pdf");
        assertThat(WhatsAppService.documentFilenameFromUrl("https://cdn.example.com/files/dir%2Fnotes.pdf"))
                .isEqualTo("notes.pdf");
    }

    @Test
    @DisplayName("a plain name without a uuid prefix is kept as-is")
    void plainNameKept() {
        assertThat(WhatsAppService.documentFilenameFromUrl("https://cdn.example.com/brochure.pdf"))
                .isEqualTo("brochure.pdf");
    }

    @Test
    @DisplayName("falls back to file.pdf when the URL carries no usable name")
    void fallsBack() {
        assertThat(WhatsAppService.documentFilenameFromUrl(null)).isEqualTo("file.pdf");
        assertThat(WhatsAppService.documentFilenameFromUrl("")).isEqualTo("file.pdf");
        assertThat(WhatsAppService.documentFilenameFromUrl("https://cdn.example.com/")).isEqualTo("file.pdf");
        assertThat(WhatsAppService.documentFilenameFromUrl("https://cdn.example.com/download")).isEqualTo("file.pdf");
        assertThat(WhatsAppService.documentFilenameFromUrl(
                "https://cdn.example.com/63a5262b-f5e4-4de6-990e-d3296ca5012b-")).isEqualTo("file.pdf");
    }
}
