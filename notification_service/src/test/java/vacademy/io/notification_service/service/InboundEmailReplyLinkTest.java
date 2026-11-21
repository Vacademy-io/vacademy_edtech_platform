package vacademy.io.notification_service.service;

import com.amazonaws.services.s3.AmazonS3;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.notification_log.entity.EmailAddressMapping;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.EmailAddressMappingRepository;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Which sent email a reply is credited to: the report's reply rate per email reads this link. */
class InboundEmailReplyLinkTest {

    private static final String LEAD = "lead@example.com";
    private static final String MAILBOX = "hello@academy.in";
    private static final String SES_ID = "010901a1a4ec06a4-48dab309-7917-4ee5-b73a-59a8c15281bd-000000";
    private static final String IN_REPLY_TO = "<" + SES_ID + "@ap-south-1.amazonses.com>";

    private NotificationLogRepository logs;
    private InboundEmailService service;

    @BeforeEach
    void setUp() {
        logs = mock(NotificationLogRepository.class);
        service = new InboundEmailService(mock(AmazonS3.class), logs, mock(EmailAddressMappingRepository.class),
                new ObjectMapper());
        when(logs.findBySourceIdAndNotificationType(any(), eq("EMAIL"))).thenReturn(List.of());
        when(logs.findTopByNotificationTypeAndSourceIdOrderByNotificationDateDesc(eq("EMAIL_EVENT"), any()))
                .thenReturn(Optional.empty());
    }

    private static NotificationLog row(String id, String source) {
        NotificationLog log = new NotificationLog();
        log.setId(id);
        log.setSource(source);
        return log;
    }

    private Optional<String> link(String inReplyTo, String instituteId) {
        return service.findRepliedToEmail(inReplyTo, LEAD, List.of(MAILBOX), instituteId).map(NotificationLog::getId);
    }

    @Test
    @DisplayName("Replying to A after B went out credits A: SES's id is on A's events")
    void sesIdFindsTheEmailActuallyAnswered() {
        NotificationLog a = row("email-a", "unified-send");
        when(logs.findTopByNotificationTypeAndSourceIdOrderByNotificationDateDesc("EMAIL_EVENT", SES_ID))
                .thenReturn(Optional.of(row("event-of-a", "email-a")));
        when(logs.findById("email-a")).thenReturn(Optional.of(a));
        when(logs.findTopByChannelIdAndSenderBusinessChannelIdAndNotificationTypeOrderByNotificationDateDesc(
                LEAD, MAILBOX, "EMAIL")).thenReturn(Optional.of(row("email-b", "unified-send")));

        assertThat(link(IN_REPLY_TO, "institute-1")).contains("email-a");
    }

    @Test
    @DisplayName("A provider that keeps our Message-ID matches it directly")
    void storedMessageIdMatchesFirst() {
        String ours = EmailService.messageIdOf("ref");
        when(logs.findBySourceIdAndNotificationType(ours, "EMAIL")).thenReturn(List.of(row("email-a", "unified-send")));

        assertThat(link(ours, "institute-1")).contains("email-a");
        verify(logs, never()).findTopByNotificationTypeAndSourceIdOrderByNotificationDateDesc(any(), any());
    }

    @Test
    @DisplayName("No event for that id: the latest email from the mailbox it was sent to")
    void fallsBackToTheMailboxInReplyTo() {
        when(logs.findTopByChannelIdAndSenderBusinessChannelIdAndNotificationTypeOrderByNotificationDateDesc(
                LEAD, MAILBOX, "EMAIL")).thenReturn(Optional.of(row("email-b", "unified-send")));

        assertThat(link(IN_REPLY_TO, "institute-1")).contains("email-b");
    }

    @Test
    @DisplayName("A known institute's mailbox never takes another institute's email")
    void neverCreditsAnotherInstitute() {
        when(logs.findTopByChannelIdAndNotificationTypeAndNotificationDateBeforeOrderByNotificationDateDesc(
                eq(LEAD), eq("EMAIL"), any())).thenReturn(Optional.of(row("otp-from-elsewhere", "OTP_SERVICE")));

        assertThat(link(IN_REPLY_TO, "institute-1")).isEmpty();
    }

    @Test
    @DisplayName("A mailbox no institute owns keeps the old latest-email guess")
    void unknownMailboxKeepsTheOldGuess() {
        when(logs.findTopByChannelIdAndNotificationTypeAndNotificationDateBeforeOrderByNotificationDateDesc(
                eq(LEAD), eq("EMAIL"), any())).thenReturn(Optional.of(row("latest", "unified-send")));

        assertThat(link(IN_REPLY_TO, null)).contains("latest");
    }

    @Test
    @DisplayName("A mail with no In-Reply-To answers nothing")
    void noInReplyToIsNotAReply() {
        assertThat(link(null, "institute-1")).isEmpty();
    }

    @Test
    @DisplayName("SES id: from any SES region's Message-ID, null for anyone else's")
    void sesMessageIdParsing() {
        assertThat(InboundEmailService.sesMessageId(IN_REPLY_TO)).isEqualTo(SES_ID);
        assertThat(InboundEmailService.sesMessageId("<abc@email.amazonses.com>")).isEqualTo("abc");
        assertThat(InboundEmailService.sesMessageId("<abc@mail.gmail.com>")).isNull();
        assertThat(InboundEmailService.sesMessageId(EmailService.messageIdOf("ref"))).isNull();
    }
}
