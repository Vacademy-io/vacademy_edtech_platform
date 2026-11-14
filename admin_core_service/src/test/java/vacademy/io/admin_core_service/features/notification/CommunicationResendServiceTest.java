package vacademy.io.admin_core_service.features.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.notification.dto.ResendCommunicationRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification.service.CommunicationResendService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * A resend is a real message to a real learner, sent under an admin's name in the audit log. Two
 * things therefore have to hold and are pinned here: the replay reaches notification-service shaped
 * the way the original send was, and the audit row describes only sends that actually left.
 */
class CommunicationResendServiceTest {

    private NotificationService notificationService;
    private CommunicationResendService service;

    @BeforeEach
    void setUp() {
        notificationService = mock(NotificationService.class);
        service = new CommunicationResendService(notificationService);
        when(notificationService.sendUnified(any())).thenReturn(accepted());
    }

    private static UnifiedSendResponse accepted() {
        UnifiedSendResponse r = new UnifiedSendResponse();
        r.setTotal(1);
        r.setAccepted(1);
        r.setFailed(0);
        r.setStatus("COMPLETED");
        return r;
    }

    private static UnifiedSendResponse rejected() {
        UnifiedSendResponse r = new UnifiedSendResponse();
        r.setTotal(1);
        r.setAccepted(0);
        r.setFailed(1);
        r.setStatus("COMPLETED"); // a refusal rides back inside a 200
        return r;
    }

    private static ResendCommunicationRequest.ResendCommunicationRequestBuilder whatsapp() {
        return ResendCommunicationRequest.builder()
                .instituteId("inst-1")
                .channel("WHATSAPP")
                .sourceLogId("log-1")
                .templateName("unlockx_registration1")
                .languageCode("en")
                .recipient("918709383266")
                .recipientUserId("user-1")
                .recipientName("Shristy")
                .variables(Map.of("name", "Shristy"));
    }

    private static ResendCommunicationRequest.ResendCommunicationRequestBuilder email() {
        return ResendCommunicationRequest.builder()
                .instituteId("inst-1")
                .channel("EMAIL")
                .sourceLogId("log-2")
                .recipient("shristy@gmail.com")
                .recipientUserId("user-1")
                .recipientName("Shristy")
                .emailSubject("Welcome to Shiksha Nation")
                .emailBody("<p>Dear Shristy</p>");
    }

    private UnifiedSendRequest captureSend() {
        ArgumentCaptor<UnifiedSendRequest> captor = ArgumentCaptor.forClass(UnifiedSendRequest.class);
        verify(notificationService).sendUnified(captor.capture());
        return captor.getValue();
    }

    @Test
    @DisplayName("WhatsApp replays the template by name, to the phone, with the original variables")
    void whatsappReplaysTemplate() {
        service.resend(whatsapp().build());

        UnifiedSendRequest sent = captureSend();
        assertThat(sent.getChannel()).isEqualTo("WHATSAPP");
        assertThat(sent.getTemplateName()).isEqualTo("unlockx_registration1");
        assertThat(sent.getRecipients()).hasSize(1);
        assertThat(sent.getRecipients().get(0).getPhone()).isEqualTo("918709383266");
        assertThat(sent.getRecipients().get(0).getEmail()).isNull();
        assertThat(sent.getRecipients().get(0).getVariables()).containsEntry("name", "Shristy");
        assertThat(sent.getOptions().getSource())
                .isEqualTo(CommunicationResendService.RESEND_SOURCE);
    }

    // Meta rejects a media-header template that arrives without its header component (#132012),
    // so the attachment the original send carried has to go out again with it.
    @Test
    @DisplayName("a media header is replayed with its attachment")
    void mediaHeaderIsReplayed() {
        service.resend(whatsapp().headerType("IMAGE").headerUrl("https://cdn/x.png").build());

        UnifiedSendRequest sent = captureSend();
        assertThat(sent.getOptions().getHeaderType()).isEqualTo("image");
        assertThat(sent.getOptions().getHeaderUrl()).isEqualTo("https://cdn/x.png");
    }

    @Test
    @DisplayName("a TEXT header carries no attachment, so none is invented")
    void textHeaderSendsNoMedia() {
        service.resend(whatsapp().headerType("TEXT").headerUrl("https://cdn/x.png").build());

        assertThat(captureSend().getOptions().getHeaderType()).isNull();
    }

    @Test
    @DisplayName("email replays the stored subject and body, and never a template name")
    void emailReplaysStoredBody() {
        service.resend(email().build());

        UnifiedSendRequest sent = captureSend();
        assertThat(sent.getChannel()).isEqualTo("EMAIL");
        assertThat(sent.getTemplateName()).isNull();
        assertThat(sent.getRecipients().get(0).getEmail()).isEqualTo("shristy@gmail.com");
        assertThat(sent.getRecipients().get(0).getPhone()).isNull();
        assertThat(sent.getOptions().getEmailSubject()).isEqualTo("Welcome to Shiksha Nation");
        assertThat(sent.getOptions().getEmailBody()).isEqualTo("<p>Dear Shristy</p>");
        // Left unset on purpose: the original send's type is not stored, and guessing it would
        // change which unsubscribe list the resend is checked against.
        assertThat(sent.getOptions().getEmailType()).isNull();
    }

    @Test
    @DisplayName("nothing is sent for a message that cannot be replayed")
    void refusesUnreplayableMessages() {
        assertThatThrownBy(() -> service.resend(whatsapp().templateName(null).build()))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.resend(email().emailBody(null).build()))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.resend(whatsapp().recipient("  ").build()))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.resend(whatsapp().instituteId(null).build()))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.resend(whatsapp().channel("PUSH").build()))
                .isInstanceOf(VacademyException.class);

        verifyNoInteractions(notificationService);
    }

    @Test
    @DisplayName("only an accepted send is audited — a refusal inside a 200 is not")
    void auditsOnlyAcceptedSends() {
        assertThat(service.wasAccepted(accepted())).isTrue();
        assertThat(service.wasAccepted(rejected())).isFalse();
        assertThat(service.wasAccepted(null)).isFalse();

        UnifiedSendResponse failed = accepted();
        failed.setStatus("FAILED");
        assertThat(service.wasAccepted(failed)).isFalse();
    }

    @Test
    @DisplayName("the log sentence names the channel, the message and the person")
    void describesTheAction() {
        assertThat(service.describe(whatsapp().build()))
                .isEqualTo("resent WhatsApp template unlockx_registration1 to Shristy");
        assertThat(service.describe(email().build()))
                .isEqualTo("resent email \"Welcome to Shiksha Nation\" to Shristy");
    }

    // Whether the admin changed a variable before resending is the difference between a duplicate
    // and a correction, so the log has to say which one happened.
    @Test
    @DisplayName("an edited resend says so")
    void describesEditedVariables() {
        assertThat(service.describe(whatsapp().variablesChanged(true).build()))
                .endsWith(" to Shristy with edited variables");
    }

    @Test
    @DisplayName("with no name on file the sentence falls back to the address it went to")
    void describesFallsBackToRecipient() {
        assertThat(service.describe(email().recipientName(null).build()))
                .endsWith(" to shristy@gmail.com");
    }
}
