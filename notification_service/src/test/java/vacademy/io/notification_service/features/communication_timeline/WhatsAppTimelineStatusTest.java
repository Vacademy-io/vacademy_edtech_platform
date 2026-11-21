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
 * The student communication timeline used to hardcode every outbound WhatsApp message as DELIVERED.
 * These pin the two halves of the fix: it now reports what the provider said, and — equally
 * important — a message that was handed over and rejected LATER keeps its send entry, because
 * "we sent it at 06:51:47" and "WhatsApp rejected it at 06:51:48" are two different facts.
 */
class WhatsAppTimelineStatusTest {

    private NotificationLogRepository repository;
    private WhatsAppTemplateRenderer renderer;
    private CommunicationTimelineService service;

    private static final Instant SENT_AT = Instant.parse("2026-08-31T06:51:47Z");
    private static final Instant REPORTED_AT = Instant.parse("2026-08-31T06:51:48Z");

    @BeforeEach
    void setUp() {
        repository = mock(NotificationLogRepository.class);
        renderer = mock(WhatsAppTemplateRenderer.class);
        when(renderer.newCache()).thenReturn(new HashMap<>());
        service = new CommunicationTimelineService(repository, new ObjectMapper(), renderer);
    }

    private NotificationLog outboundRow() {
        NotificationLog log = new NotificationLog();
        log.setId("log-1");
        log.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
        log.setChannelId("917999873846");
        log.setUserId("user-1");
        log.setSourceId("wamid.ONE");
        log.setSource("whatsapp-service");
        log.setBody("WhatsApp Template: whatsappenquirymsg | Provider: META | Status: SUCCESS | Params: {}");
        log.setNotificationDate(SENT_AT);
        return log;
    }

    private UnifiedCommunicationDTO firstItemFor(NotificationLog row) {
        Page<NotificationLog> page = new PageImpl<>(List.of(row), Pageable.ofSize(20), 1);
        when(repository.findByUserIdAndNotificationTypeInOrderByNotificationDateDesc(
                anyString(), anyList(), any(Pageable.class))).thenReturn(page);

        CommunicationTimelineRequest request = new CommunicationTimelineRequest();
        request.setUserId("user-1");
        request.setChannels(List.of("WHATSAPP"));

        return service.getUserCommunications(request).getContent().get(0);
    }

    @Test
    @DisplayName("a message WhatsApp rejected reads as failed, not delivered")
    void rejectedMessageReportsFailed() {
        NotificationLog row = outboundRow();
        row.setDeliveryStatus("FAILED");
        row.setDeliveryErrorCode("131042");
        row.setDeliveryErrorMessage("Business eligibility payment issue");
        row.setDeliveryUpdatedAt(REPORTED_AT);

        UnifiedCommunicationDTO item = firstItemFor(row);

        assertThat(item.getStatus()).isEqualTo("FAILED");
        // The handover still happened and must remain visible; the rejection is a second event.
        assertThat(item.getStatusTimeline()).hasSize(2);
        assertThat(item.getStatusTimeline().get(0).getStatus()).isEqualTo("SENT");
        assertThat(item.getStatusTimeline().get(0).getTimestamp()).isEqualTo(SENT_AT);
        assertThat(item.getStatusTimeline().get(1).getStatus()).isEqualTo("FAILED");
        assertThat(item.getStatusTimeline().get(1).getTimestamp()).isEqualTo(REPORTED_AT);
        assertThat(item.getStatusTimeline().get(1).getDetails())
                .isEqualTo("Business eligibility payment issue (131042)");
    }

    @Test
    @DisplayName("a read message reports READ, with both events on the timeline")
    void readMessageReportsRead() {
        NotificationLog row = outboundRow();
        row.setDeliveryStatus("READ");
        row.setDeliveryUpdatedAt(REPORTED_AT);

        UnifiedCommunicationDTO item = firstItemFor(row);

        assertThat(item.getStatus()).isEqualTo("READ");
        assertThat(item.getStatusTimeline()).extracting(UnifiedCommunicationDTO.StatusEvent::getStatus)
                .containsExactly("SENT", "READ");
    }

    @Test
    @DisplayName("no webhook reported: the pre-existing optimistic display is left exactly as it was")
    void unreportedMessageKeepsLegacyBehaviour() {
        UnifiedCommunicationDTO item = firstItemFor(outboundRow());

        assertThat(item.getStatus()).isEqualTo("DELIVERED");
        assertThat(item.getStatusTimeline()).hasSize(1);
        assertThat(item.getStatusTimeline().get(0).getStatus()).isEqualTo("SENT");
    }

    @Test
    @DisplayName("a send the provider refused outright still fails at the send entry itself")
    void refusedSendFailsAtHandover() {
        WhatsAppTemplateRenderer.Rendered rendered = new WhatsAppTemplateRenderer.Rendered();
        rendered.templateName = "whatsappenquirymsg";
        rendered.body = "Hi";
        rendered.deliveryStatus = "FAILED";
        rendered.error = "132000 number of parameters does not match";
        when(renderer.render(any(), any(), any())).thenReturn(rendered);

        // No delivery_status: the message never reached WhatsApp, so no webhook can exist for it.
        UnifiedCommunicationDTO item = firstItemFor(outboundRow());

        assertThat(item.getStatus()).isEqualTo("FAILED");
        assertThat(item.getStatusTimeline()).hasSize(1);
        assertThat(item.getStatusTimeline().get(0).getStatus()).isEqualTo("FAILED");
    }
}
