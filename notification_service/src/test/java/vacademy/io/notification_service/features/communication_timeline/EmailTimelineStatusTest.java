package vacademy.io.notification_service.features.communication_timeline;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppTemplateRenderer;
import vacademy.io.notification_service.features.communication_timeline.dto.CommunicationTimelineRequest;
import vacademy.io.notification_service.features.communication_timeline.dto.UnifiedCommunicationDTO;
import vacademy.io.notification_service.features.communication_timeline.service.CommunicationTimelineService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The email half of the timeline used to report PENDING whenever no SES tracking event had been
 * linked to a send. SES event ingestion stopped platform-wide on 2026-07-28, so ~113k delivered
 * emails sat behind an amber "Pending" chip while the very same row's timeline said "Email sent".
 * These pin the corrected reading: the EMAIL row exists only because SMTP accepted the message, so
 * the absence of a tracking event means "no delivery confirmation", never "not sent" — while a
 * send our own code refused still has to read as FAILED.
 */
class EmailTimelineStatusTest {

    private NotificationLogRepository repository;
    private CommunicationTimelineService service;

    private static final Instant SENT_AT = Instant.parse("2026-08-31T11:07:37Z");
    private static final Instant REPORTED_AT = Instant.parse("2026-08-31T11:07:41Z");

    @BeforeEach
    void setUp() {
        repository = mock(NotificationLogRepository.class);
        WhatsAppTemplateRenderer renderer = mock(WhatsAppTemplateRenderer.class);
        when(renderer.newCache()).thenReturn(new HashMap<>());
        service = new CommunicationTimelineService(repository, new ObjectMapper(), renderer);
    }

    private NotificationLog emailRow() {
        NotificationLog log = new NotificationLog();
        log.setId("log-1");
        log.setNotificationType("EMAIL");
        log.setChannelId("zainabm.edustream@gmail.com");
        log.setSenderBusinessChannelId("learn@edustream.ae");
        log.setUserId("user-1");
        log.setSource("unified-send");
        log.setBody("Login Credentials");
        log.setNotificationDate(SENT_AT);
        return log;
    }

    /** An EMAIL_EVENT row as EmailEventService writes it: the SES event type lives in the body. */
    private NotificationLog trackingEvent(String eventType) {
        NotificationLog event = new NotificationLog();
        event.setId("event-1");
        event.setNotificationType("EMAIL_EVENT");
        event.setSource("log-1"); // links back to the EMAIL row
        event.setChannelId("zainabm.edustream@gmail.com");
        event.setBody("Email Event: " + eventType + "\nMessage ID: 0109-abc\n");
        event.setNotificationDate(REPORTED_AT);
        event.setCreatedAt(REPORTED_AT);
        return event;
    }

    private UnifiedCommunicationDTO firstItemFor(NotificationLog row, NotificationLog... events) {
        Page<NotificationLog> page = new PageImpl<>(List.of(row), Pageable.ofSize(20), 1);
        when(repository.findByUserIdAndNotificationTypeInOrderByNotificationDateDesc(
                anyString(), anyList(), any(Pageable.class))).thenReturn(page);
        when(repository.findLatestEmailEventsBySourceIdsNative(any(String[].class)))
                .thenReturn(List.of(events));
        when(repository.findEmailEventsBySourceIds(anyList())).thenReturn(List.of(events));

        CommunicationTimelineRequest request = new CommunicationTimelineRequest();
        request.setUserId("user-1");
        request.setChannels(List.of("EMAIL"));

        return service.getUserCommunications(request).getContent().get(0);
    }

    @Test
    @DisplayName("no SES event yet: the mail reads as SENT, not PENDING")
    void untrackedEmailReportsSent() {
        UnifiedCommunicationDTO item = firstItemFor(emailRow());

        assertThat(item.getStatus()).isEqualTo("SENT");
        assertThat(item.getStatusTimeline()).hasSize(1);
        assertThat(item.getStatusTimeline().get(0).getStatus()).isEqualTo("SENT");
        assertThat(item.getStatusTimeline().get(0).getTimestamp()).isEqualTo(SENT_AT);
    }

    @Test
    @DisplayName("SES confirmed delivery: the provider's outcome wins over the default")
    void deliveredEmailReportsDelivered() {
        UnifiedCommunicationDTO item = firstItemFor(emailRow(), trackingEvent("DELIVERY"));

        assertThat(item.getStatus()).isEqualTo("DELIVERED");
        assertThat(item.getStatusTimeline()).extracting(UnifiedCommunicationDTO.StatusEvent::getStatus)
                .containsExactly("SENT", "DELIVERED");
    }

    @Test
    @DisplayName("SES reported a bounce: the failure is not softened into SENT")
    void bouncedEmailReportsBounced() {
        UnifiedCommunicationDTO item = firstItemFor(emailRow(), trackingEvent("BOUNCE"));

        assertThat(item.getStatus()).isEqualTo("BOUNCED");
    }

    @Test
    @DisplayName("an unrecognised event body falls through to SENT rather than showing PENDING")
    void unparseableEventStillReportsSent() {
        NotificationLog garbled = trackingEvent("DELIVERY");
        garbled.setBody("something we cannot parse");

        UnifiedCommunicationDTO item = firstItemFor(emailRow(), garbled);

        assertThat(item.getStatus()).isEqualTo("SENT");
    }

    @Test
    @DisplayName("a send our own code refused reads as FAILED, with the reason instead of 'Email sent'")
    void refusedSendReportsFailedWithReason() {
        NotificationLog row = emailRow();
        row.setSource("announcement-service");
        row.setDeliveryStatus("FAILED");
        row.setDeliveryErrorMessage("User unsubscribed from emails sent from learn@edustream.ae (UTILITY_EMAIL)");
        row.setDeliveryUpdatedAt(SENT_AT);

        UnifiedCommunicationDTO item = firstItemFor(row);

        assertThat(item.getStatus()).isEqualTo("FAILED");
        assertThat(item.getStatusTimeline()).hasSize(1);
        assertThat(item.getStatusTimeline().get(0).getStatus()).isEqualTo("FAILED");
        assertThat(item.getStatusTimeline().get(0).getDetails())
                .isEqualTo("User unsubscribed from emails sent from learn@edustream.ae (UTILITY_EMAIL)");
    }

    @Test
    @DisplayName("a stored failure never outranks a real SES event for the same mail")
    void trackingEventOutranksStoredFailure() {
        NotificationLog row = emailRow();
        row.setDeliveryStatus("FAILED");

        UnifiedCommunicationDTO item = firstItemFor(row, trackingEvent("DELIVERY"));

        assertThat(item.getStatus()).isEqualTo("DELIVERED");
    }
}
