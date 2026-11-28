package vacademy.io.notification_service.service;

import com.amazonaws.services.s3.AmazonS3;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.notification_service.features.bounced_emails.service.BounceNoticeRecipients;
import vacademy.io.notification_service.features.bounced_emails.service.BouncedEmailService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.EmailAddressMappingRepository;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** A bounce notice mail blocks its recipient when the SES bounce event never arrived. */
class InboundBounceNoticeTest {

    private static final String SES = "mailer-daemon@ap-south-1.amazonses.com";
    private static final String NOTICE =
            "An error occurred while trying to deliver the mail to the following recipients:\r\nInfo@Academy-One.test\r\n";

    private final BouncedEmailService blocklist = mock(BouncedEmailService.class);
    private final NotificationLogRepository logs = mock(NotificationLogRepository.class);

    private InboundEmailService service() {
        var s = new InboundEmailService(mock(AmazonS3.class), logs, mock(EmailAddressMappingRepository.class),
                new ObjectMapper());
        ReflectionTestUtils.setField(s, "bouncedEmailService", blocklist);
        return s;
    }

    private void mailedAgo(String email, Duration ago) {
        NotificationLog sent = new NotificationLog();
        sent.setId("log1");
        sent.setNotificationDate(Instant.now().minus(ago));
        when(logs.findTopByChannelIdAndNotificationTypeOrderByNotificationDateDesc(email, "EMAIL"))
                .thenReturn(Optional.of(sent));
    }

    @Test
    @DisplayName("reads SES's recipient list and Gmail's not-found wording, lowercase")
    void parsesBothWordings() {
        assertEquals(List.of("info@academy-one.test"), BounceNoticeRecipients.parse(SES, NOTICE));
        assertEquals(List.of("a@x.com", "b@y.in"), BounceNoticeRecipients.parse(SES,
                "to the following recipients: a@x.com, b@y.in\nThanks"));
        assertEquals(List.of("info@academy-two.test"), BounceNoticeRecipients.parse(SES,
                "** Address not found ** Your message wasn’t delivered to info@academy-two.test because"
                        + " the address couldn't be found, or is unable to receive mail."));
    }

    @Test
    @DisplayName("anything else blocks nobody: a real sender, a lookalike domain, or a server problem")
    void ignoresEverythingElse() {
        assertTrue(BounceNoticeRecipients.parse("priya@school.in", NOTICE).isEmpty());
        assertTrue(BounceNoticeRecipients.parse("mailer-daemon@amazonses.com.evil.io", NOTICE).isEmpty());
        assertTrue(BounceNoticeRecipients.parse(SES, "Your message couldn't be delivered to x@y.com because"
                + " the remote server is misconfigured.").isEmpty());
        assertTrue(BounceNoticeRecipients.parse(SES, null).isEmpty());
        assertTrue(BounceNoticeRecipients.parse(null, NOTICE).isEmpty());
    }

    @Test
    @DisplayName("a notice about an address we just mailed puts it on the blocklist")
    void blocksRecentlyMailed() {
        mailedAgo("info@academy-one.test", Duration.ofMinutes(2));

        service().recordBounceNotice(SES, NOTICE, "msg1");

        verify(blocklist).addBouncedEmail("info@academy-one.test", BounceNoticeRecipients.BOUNCE_TYPE,
                BounceNoticeRecipients.BOUNCE_SUB_TYPE, "From the bounce notice email", "msg1", "log1");
    }

    @Test
    @DisplayName("a forged notice cannot block an address we never mailed or mailed long ago")
    void refusesUnmailed() {
        when(logs.findTopByChannelIdAndNotificationTypeOrderByNotificationDateDesc(any(), any()))
                .thenReturn(Optional.empty());
        service().recordBounceNotice(SES, NOTICE, "msg1");
        mailedAgo("info@academy-one.test", Duration.ofDays(30));
        service().recordBounceNotice(SES, NOTICE, "msg2");

        verify(blocklist, never()).addBouncedEmail(any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("an address the SES event already blocked keeps its richer record")
    void keepsExistingRecord() {
        when(blocklist.isEmailBlocked("info@academy-one.test")).thenReturn(true);

        service().recordBounceNotice(SES, NOTICE, "msg1");

        verify(blocklist, never()).addBouncedEmail(any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a blocklist failure never loses the inbound email")
    void neverFailsTheIngest() {
        when(blocklist.isEmailBlocked(any())).thenThrow(new IllegalStateException("db down"));

        assertDoesNotThrow(() -> service().recordBounceNotice(SES, NOTICE, "msg1"));
    }
}
