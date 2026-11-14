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
 * An outbound EMAIL row stores the rendered HTML in {@code body} and parks the subject line in
 * {@code message_payload} — so the timeline's {@code title}, a 100-char truncation of that HTML, is
 * not the subject and never was. The admin dashboard papered over it by scraping the body's
 * {@code <title>}/{@code <h1>}, which is a guess: resending a message off that guess would put a
 * heading from inside the email on the envelope. These pin the real subject coming back on its own
 * field, and the field staying null (rather than inventing one) when the row predates it.
 */
class EmailTimelineSubjectTest {

    private NotificationLogRepository repository;
    private CommunicationTimelineService service;

    private static final Instant SENT_AT = Instant.parse("2026-09-21T06:30:00Z");

    @BeforeEach
    void setUp() {
        repository = mock(NotificationLogRepository.class);
        WhatsAppTemplateRenderer renderer = mock(WhatsAppTemplateRenderer.class);
        when(renderer.newCache()).thenReturn(new HashMap<>());
        service = new CommunicationTimelineService(repository, new ObjectMapper(), renderer);
    }

    private NotificationLog emailRow(String messagePayload) {
        NotificationLog log = new NotificationLog();
        log.setId("log-1");
        log.setNotificationType("EMAIL");
        log.setChannelId("niresha358@gmail.com");
        log.setSenderBusinessChannelId("hello@shikshanation.com");
        log.setUserId("user-1");
        log.setSource("unified-send");
        log.setBody("<html><head><title>Inner heading</title></head><body>Welcome…</body></html>");
        log.setMessagePayload(messagePayload);
        log.setNotificationDate(SENT_AT);
        return log;
    }

    private UnifiedCommunicationDTO firstItemFor(NotificationLog row) {
        Page<NotificationLog> page = new PageImpl<>(List.of(row), Pageable.ofSize(20), 1);
        when(repository.findByUserIdAndNotificationTypeInOrderByNotificationDateDesc(
                anyString(), anyList(), any(Pageable.class))).thenReturn(page);
        when(repository.findLatestEmailEventsBySourceIdsNative(any(String[].class)))
                .thenReturn(List.of());
        when(repository.findEmailEventsBySourceIds(anyList())).thenReturn(List.of());

        CommunicationTimelineRequest request = new CommunicationTimelineRequest();
        request.setUserId("user-1");
        request.setChannels(List.of("EMAIL"));

        return service.getUserCommunications(request).getContent().get(0);
    }

    @Test
    @DisplayName("the stored subject comes back on its own field, not scraped from the HTML")
    void storedSubjectIsReturned() {
        UnifiedCommunicationDTO item = firstItemFor(
                emailRow("{\"subject\":\"Welcome to Shiksha Nation\"}"));

        assertThat(item.getSubject()).isEqualTo("Welcome to Shiksha Nation");
        // title keeps its old meaning — a truncation of the body — so nothing reading it shifts.
        assertThat(item.getTitle()).startsWith("<html>");
    }

    @Test
    @DisplayName("a row with no payload reports no subject rather than inventing one")
    void missingPayloadLeavesSubjectNull() {
        assertThat(firstItemFor(emailRow(null)).getSubject()).isNull();
    }

    @Test
    @DisplayName("a payload without a subject key reports no subject")
    void payloadWithoutSubjectLeavesSubjectNull() {
        assertThat(firstItemFor(emailRow("{\"messageId\":\"0109-abc\"}")).getSubject()).isNull();
    }

    @Test
    @DisplayName("a blank subject is treated as absent, so the caller falls back instead of showing nothing")
    void blankSubjectLeavesSubjectNull() {
        assertThat(firstItemFor(emailRow("{\"subject\":\"   \"}")).getSubject()).isNull();
    }

    @Test
    @DisplayName("an unparseable payload never breaks the row it belongs to")
    void malformedPayloadIsSurvivable() {
        UnifiedCommunicationDTO item = firstItemFor(emailRow("not json at all"));

        assertThat(item.getSubject()).isNull();
        assertThat(item.getStatus()).isEqualTo("SENT");
    }
}
