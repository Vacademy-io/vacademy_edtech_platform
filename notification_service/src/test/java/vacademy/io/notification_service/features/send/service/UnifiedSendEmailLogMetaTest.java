package vacademy.io.notification_service.features.send.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * What an EMAIL send records beside its subject for the student timeline: the template it was
 * built from and who sent it.
 */
class UnifiedSendEmailLogMetaTest {

    private static UnifiedSendRequest request(String templateName, UnifiedSendRequest.SendOptions opts) {
        return UnifiedSendRequest.builder().channel("EMAIL").templateName(templateName).options(opts).build();
    }

    @Test
    @DisplayName("the display-only template label wins over the looked-up template")
    void labelWinsOverLookup() {
        UnifiedSendRequest.SendOptions opts = UnifiedSendRequest.SendOptions.builder()
                .logTemplateName("VTC welcome email").build();

        assertThat(UnifiedSendService.emailLogMeta(request("db_template", opts), opts))
                .containsEntry("templateName", "VTC welcome email");
    }

    @Test
    @DisplayName("a send that looked up its template by name records that name")
    void lookedUpTemplateRecorded() {
        UnifiedSendRequest.SendOptions opts = UnifiedSendRequest.SendOptions.builder().build();

        assertThat(UnifiedSendService.emailLogMeta(request("db_template", opts), opts))
                .containsEntry("templateName", "db_template");
    }

    @Test
    @DisplayName("an admin resend records the admin as the origin")
    void adminOriginRecorded() {
        UnifiedSendRequest.SendOptions opts = UnifiedSendRequest.SendOptions.builder()
                .originType("ADMIN_RESEND").originId("admin-7").originName("Sarita R").build();

        assertThat(UnifiedSendService.emailLogMeta(request(null, opts), opts)).isEqualTo(Map.of(
                "originType", "ADMIN_RESEND", "originId", "admin-7", "originName", "Sarita R"));
    }

    @Test
    @DisplayName("a plain send records nothing extra")
    void plainSendRecordsNothing() {
        UnifiedSendRequest.SendOptions opts = UnifiedSendRequest.SendOptions.builder().build();

        assertThat(UnifiedSendService.emailLogMeta(request(null, opts), opts)).isEmpty();
    }
}
