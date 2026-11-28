package vacademy.io.notification_service.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.dto.SesEventDTO;
import vacademy.io.notification_service.features.bounced_emails.service.BouncedEmailService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** An SES event lands on the email it belongs to, not on the latest email to that address. */
class EmailEventTaggedLinkTest {

    private static final String LEAD = "lead@example.com";

    private NotificationLogRepository logs;
    private EmailEventService service;

    @BeforeEach
    void setUp() {
        logs = mock(NotificationLogRepository.class);
        service = new EmailEventService(logs, mock(BouncedEmailService.class));
        when(logs.findBySourceAndNotificationType(any(), eq("EMAIL_EVENT"))).thenReturn(List.of());
        when(logs.findBySourceIdAndNotificationType(any(), eq("EMAIL"))).thenReturn(List.of());
        // The guess: the latest email to that address, which is B.
        when(logs.findTopByChannelIdAndNotificationTypeAndNotificationDateBeforeOrderByNotificationDateDesc(
                eq(LEAD), eq("EMAIL"), any())).thenReturn(Optional.of(email("email-b")));
    }

    private static NotificationLog email(String id) {
        NotificationLog log = new NotificationLog();
        log.setId(id);
        log.setNotificationDate(Instant.now());
        return log;
    }

    private static SesEventDTO delivery(Map<String, String[]> tags) {
        SesEventDTO.CommonHeadersDTO headers = new SesEventDTO.CommonHeadersDTO();
        headers.setTo(new String[]{LEAD});
        SesEventDTO.MailDTO mail = new SesEventDTO.MailDTO();
        mail.setMessageId("ses-id");
        mail.setCommonHeaders(headers);
        mail.setTags(tags);
        SesEventDTO.DeliveryDTO delivery = new SesEventDTO.DeliveryDTO();
        delivery.setTimestamp(Instant.now().toString());
        SesEventDTO event = new SesEventDTO();
        event.setEventType("Delivery");
        event.setMail(mail);
        event.setDelivery(delivery);
        return event;
    }

    private String savedSource() {
        ArgumentCaptor<NotificationLog> saved = ArgumentCaptor.forClass(NotificationLog.class);
        verify(logs).save(saved.capture());
        return saved.getValue().getSource();
    }

    @Test
    @DisplayName("A tagged event goes to its own email even though a later one went out")
    void taggedEventFindsItsOwnEmail() {
        when(logs.findBySourceIdAndNotificationType(EmailService.messageIdOf("ref-a"), "EMAIL"))
                .thenReturn(List.of(email("email-a")));

        service.processEmailEvent(delivery(Map.of(EmailService.SES_TAG_MESSAGE_REF, new String[]{"ref-a"})));

        assertThat(savedSource()).isEqualTo("email-a");
    }

    @Test
    @DisplayName("No tag (OTP mail, older mail): still the latest email to that address")
    void untaggedEventKeepsTheGuess() {
        service.processEmailEvent(delivery(null));

        assertThat(savedSource()).isEqualTo("email-b");
    }

    @Test
    @DisplayName("The tagged email's row isn't saved yet: the event isn't lost")
    void taggedEventWithoutARowKeepsTheGuess() {
        service.processEmailEvent(delivery(Map.of(EmailService.SES_TAG_MESSAGE_REF, new String[]{"ref-a"})));

        assertThat(savedSource()).isEqualTo("email-b");
    }
}
