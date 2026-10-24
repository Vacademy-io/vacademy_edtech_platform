package vacademy.io.notification_service.features.chatbot_flow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxConversationDTO;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.service.ChatbotEscalationService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppInboxService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppMediaPolicy;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppSendFailureService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppTemplateRenderer;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The delivery ticks on a conversation row.
 *
 * <p>The Inbox list used to draw one hard-coded tick on every outgoing row, so a message that had
 * been read hours earlier and one WhatsApp had refused looked identical — and identical to a
 * message that had only just left. The row now carries WhatsApp's own verdict, which means it has
 * to be the same verdict the thread shows: the status webhook's when there is one, the refused-send
 * marker when the provider never accepted the message at all, and nothing at all when neither has
 * spoken.
 */
class WhatsAppInboxConversationStatusTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "919555622068";

    private NotificationLogRepository logRepository;
    private WhatsAppInboxService service;

    @BeforeEach
    void setUp() {
        logRepository = mock(NotificationLogRepository.class);
        ChatbotEscalationService escalationService = mock(ChatbotEscalationService.class);
        WhatsAppTemplateRenderer renderer = mock(WhatsAppTemplateRenderer.class);
        when(renderer.newCache()).thenReturn(new HashMap<>());
        when(renderer.displayBody(any(), anyString(), any())).thenReturn("hi");

        when(escalationService.findPendingPhones(anyString())).thenReturn(Set.of());
        when(escalationService.findPendingByPhone(anyString(), anyList())).thenReturn(Map.of());

        service = new WhatsAppInboxService(
                logRepository,
                mock(ChannelToInstituteMappingRepository.class),
                renderer,
                escalationService,
                mock(WhatsAppSendFailureService.class),
                mock(WhatsAppMediaPolicy.class),
                new ObjectMapper(),
                List.of(mock(ChatbotMessageProvider.class)));
    }

    private NotificationLog outgoing() {
        NotificationLog log = new NotificationLog();
        log.setChannelId(PHONE);
        log.setInstituteId(INSTITUTE);
        log.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
        log.setNotificationDate(Instant.parse("2026-09-08T12:00:00Z"));
        return log;
    }

    private InboxConversationDTO listed(NotificationLog row) {
        when(logRepository.findConversationsForInbox(anyString(), anyInt(), anyInt()))
                .thenReturn(List.of(row));
        List<InboxConversationDTO> conversations = service.getConversations(INSTITUTE, 0, 30, "ALL");
        assertThat(conversations).hasSize(1);
        return conversations.get(0);
    }

    @Test
    @DisplayName("the row reports what WhatsApp's status webhook said about the last message")
    void carriesTheReportedDeliveryStatus() {
        NotificationLog row = outgoing();
        row.setDeliveryStatus("READ");

        assertThat(listed(row).getLastMessageStatus()).isEqualTo("READ");
    }

    @Test
    @DisplayName("a send the provider refused outright reads FAILED, even with no status webhook")
    void readsTheRefusedSendMarker() {
        NotificationLog row = outgoing();
        row.setMessagePayload("{\"deliveryStatus\":\"FAILED\",\"error\":\"Re-engagement message (131047)\"}");

        assertThat(listed(row).getLastMessageStatus()).isEqualTo("FAILED");
    }

    @Test
    @DisplayName("nothing reported stays null — silence from WhatsApp is not a delivery claim")
    void unreportedStatusStaysNull() {
        NotificationLog row = outgoing();
        row.setMessagePayload("{\"templateName\":\"demo_utility\"}");

        assertThat(listed(row).getLastMessageStatus()).isNull();
    }

    @Test
    @DisplayName("an incoming last message carries no status — ticks are for messages we sent")
    void incomingHasNoStatus() {
        NotificationLog row = outgoing();
        row.setNotificationType("WHATSAPP_MESSAGE_INCOMING");
        row.setDeliveryStatus("READ");

        InboxConversationDTO conversation = listed(row);
        assertThat(conversation.getLastMessageType()).isEqualTo("INCOMING");
        assertThat(conversation.getLastMessageStatus()).isNull();
    }

    @Test
    @DisplayName("search returns the same row shape as the list, ticks included")
    void searchCarriesTheSameStatus() {
        NotificationLog row = outgoing();
        row.setDeliveryStatus("DELIVERED");
        when(logRepository.searchConversations(anyString(), anyString())).thenReturn(List.of(row));

        List<InboxConversationDTO> found = service.searchConversations(INSTITUTE, "9195");

        assertThat(found).singleElement()
                .extracting(InboxConversationDTO::getLastMessageStatus)
                .isEqualTo("DELIVERED");
    }
}
