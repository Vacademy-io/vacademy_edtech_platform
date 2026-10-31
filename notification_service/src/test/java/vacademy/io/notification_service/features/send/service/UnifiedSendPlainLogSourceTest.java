package vacademy.io.notification_service.features.send.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.announcements.service.UserAnnouncementPreferenceService;
import vacademy.io.notification_service.features.chatbot_flow.repository.NotificationTemplateRepository;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.repository.SendBatchRepository;
import vacademy.io.notification_service.service.EmailService;
import vacademy.io.notification_service.service.WhatsAppService;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Writer side of the inbox origin contract: the source UnifiedSendService hands EmailService
 * (and therefore notification_log.source) is EMAIL_INBOX for an inbox reply and 'unified-send'
 * for every other plain send — the two values EmailThreadMerger / EmailInboxService key on.
 */
class UnifiedSendPlainLogSourceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String TO = "shreyash@vidyayatan.com";

    private EmailService emailService;
    private UnifiedSendService service;

    @BeforeEach
    void setUp() {
        emailService = mock(EmailService.class);
        EmailCcResolver ccResolver = mock(EmailCcResolver.class);
        when(ccResolver.resolve(any(), any())).thenReturn(new EmailCcResolver.CopyRecipients(List.of(), "BCC"));
        when(emailService.sendHtmlEmail(anyString(), anyString(), anyString(), anyString(), any(), any(), any(), any(),
                any(), any(), any(), any())).thenReturn(EmailService.SendOutcome.SENT);
        service = new UnifiedSendService(
                mock(WhatsAppService.class),
                emailService,
                mock(PushNotificationService.class),
                mock(SendBatchRepository.class),
                new ObjectMapper(),
                mock(BatchProcessorService.class),
                mock(NotificationTemplateRepository.class),
                mock(UserAnnouncementPreferenceService.class),
                ccResolver,
                mock(NotificationLogRepository.class));
    }

    private UnifiedSendRequest emailRequest(String source) {
        return UnifiedSendRequest.builder()
                .instituteId(INSTITUTE)
                .channel("EMAIL")
                .recipients(List.of(UnifiedSendRequest.Recipient.builder().email(TO).build()))
                .options(UnifiedSendRequest.SendOptions.builder()
                        .emailSubject("Re: hello").emailBody("<p>Sure</p>").source(source).build())
                .build();
    }

    private String loggedSource(String optsSource) {
        service.routeSync(emailRequest(optsSource));
        ArgumentCaptor<String> source = ArgumentCaptor.forClass(String.class);
        verify(emailService).sendHtmlEmail(eq(TO), anyString(), source.capture(), anyString(), eq(INSTITUTE),
                any(), any(), any(), any(), any(), any(), any());
        return source.getValue();
    }

    @Test
    @DisplayName("inbox reply is logged as EMAIL_INBOX so the thread can label it INBOX_REPLY")
    void inboxReplyKeepsItsSource() {
        assertThat(loggedSource(UnifiedSendService.INBOX_REPLY_SOURCE)).isEqualTo("EMAIL_INBOX");
    }

    @Test
    @DisplayName("an announcement's SMTP row is logged as 'unified-send' — the only source the twin merger pairs with")
    void announcementSendIsLoggedAsUnifiedSend() {
        assertThat(loggedSource("announcement-service")).isEqualTo("unified-send");
        assertThat(UnifiedSendService.PLAIN_LOG_SOURCE).isEqualTo("unified-send");
    }

    @Test
    void anyOtherCallerSourceIsAlsoUnifiedSend() {
        assertThat(UnifiedSendService.plainLogSource(null)).isEqualTo("unified-send");
        assertThat(UnifiedSendService.plainLogSource("share-credentials")).isEqualTo("unified-send");
        assertThat(UnifiedSendService.plainLogSource("EMAIL_INBOX")).isEqualTo("EMAIL_INBOX");
    }
}
