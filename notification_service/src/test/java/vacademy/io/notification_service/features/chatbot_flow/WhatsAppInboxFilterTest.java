package vacademy.io.notification_service.features.chatbot_flow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The two Inbox tabs — Unanswered and Not delivered.
 *
 * <p>Both used to come back empty on every institute in production. Unanswered listed only open
 * chatbot escalations, which almost no institute has, and Not delivered matched a
 * {@code deliveryStatus} marker inside message_payload that no row has ever carried — real
 * failures land on the {@code delivery_status} column, stamped later by WhatsApp's status webhook.
 */
class WhatsAppInboxFilterTest {

    private static final String INSTITUTE = "inst-1";

    private NotificationLogRepository logRepository;
    private ChatbotEscalationService escalationService;
    private WhatsAppInboxService service;

    @BeforeEach
    void setUp() {
        logRepository = mock(NotificationLogRepository.class);
        escalationService = mock(ChatbotEscalationService.class);
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

    private NotificationLog row(String phone, String type) {
        NotificationLog log = new NotificationLog();
        log.setChannelId(phone);
        log.setInstituteId(INSTITUTE);
        log.setNotificationType(type);
        log.setNotificationDate(Instant.parse("2026-09-08T12:00:00Z"));
        return log;
    }

    // ==================== Unanswered ====================

    @Test
    @DisplayName("Unanswered lists conversations the learner spoke last on, with no escalation anywhere")
    void unansweredWorksWithoutEscalations() {
        when(logRepository.findUnansweredConversations(anyString(), anyList(), anyInt(), anyInt()))
                .thenReturn(List.of(row("919876543210", "WHATSAPP_MESSAGE_INCOMING")));

        List<InboxConversationDTO> conversations =
                service.getConversations(INSTITUTE, 0, 30, "UNANSWERED");

        assertThat(conversations).extracting(InboxConversationDTO::getPhone)
                .containsExactly("919876543210");
        // The escalation table is no longer the gate — it must not be able to empty the tab.
        verify(logRepository, never()).findConversationsForInbox(anyString(), anyInt(), anyInt());
    }

    @Test
    @DisplayName("with no open hand-over the phone clause gets a sentinel, never an empty IN ()")
    void unansweredPassesSentinelWhenNoEscalations() {
        when(logRepository.findUnansweredConversations(anyString(), anyList(), anyInt(), anyInt()))
                .thenReturn(List.of());

        service.getConversations(INSTITUTE, 0, 30, "UNANSWERED");

        ArgumentCaptor<List<String>> phones = ArgumentCaptor.forClass(List.class);
        verify(logRepository).findUnansweredConversations(
                anyString(), phones.capture(), anyInt(), anyInt());
        assertThat(phones.getValue()).isNotEmpty();
    }

    @Test
    @DisplayName("open hand-overs are folded in, so a conversation the bot answered last still shows")
    void unansweredIncludesPendingEscalationPhones() {
        when(escalationService.findPendingPhones(INSTITUTE)).thenReturn(Set.of("919999999999"));
        when(logRepository.findUnansweredConversations(anyString(), anyList(), anyInt(), anyInt()))
                .thenReturn(List.of());

        service.getConversations(INSTITUTE, 0, 30, "UNANSWERED");

        ArgumentCaptor<List<String>> phones = ArgumentCaptor.forClass(List.class);
        verify(logRepository).findUnansweredConversations(
                anyString(), phones.capture(), anyInt(), anyInt());
        assertThat(phones.getValue()).containsExactly("919999999999");
    }

    @Test
    @DisplayName("a conversation ending on an inbound message is badged Unanswered without an escalation")
    void awaitingReplyFollowsTheLastMessageDirection() {
        when(logRepository.findConversationsForInbox(anyString(), anyInt(), anyInt()))
                .thenReturn(List.of(
                        row("919876543210", "WHATSAPP_MESSAGE_INCOMING"),
                        row("919876500000", "WHATSAPP_MESSAGE_OUTGOING")));

        List<InboxConversationDTO> conversations = service.getConversations(INSTITUTE, 0, 30, "ALL");

        assertThat(conversations).extracting(
                        InboxConversationDTO::getPhone, InboxConversationDTO::isAwaitingReply)
                .containsExactly(
                        org.assertj.core.api.Assertions.tuple("919876543210", true),
                        org.assertj.core.api.Assertions.tuple("919876500000", false));
    }

    // ==================== Not delivered ====================

    @Test
    @DisplayName("Not delivered asks for both failure shapes: the webhook column and the refused-send marker")
    void failedFilterUsesTheFailureQuery() {
        when(logRepository.findConversationsWithFailedSends(anyString(), anyString(), anyInt(), anyInt()))
                .thenReturn(List.of(row("919876543210", "WHATSAPP_MESSAGE_OUTGOING")));

        List<InboxConversationDTO> conversations =
                service.getConversations(INSTITUTE, 0, 30, "FAILED");

        assertThat(conversations).hasSize(1);
        verify(logRepository).findConversationsWithFailedSends(
                anyString(), anyString(), anyInt(), anyInt());
        verify(logRepository, never()).findConversationsForInbox(anyString(), anyInt(), anyInt());
    }

    @Test
    @DisplayName("an unknown or blank filter still means everything")
    void unknownFilterFallsBackToAll() {
        when(logRepository.findConversationsForInbox(anyString(), anyInt(), anyInt()))
                .thenReturn(List.of(row("919876543210", "WHATSAPP_MESSAGE_INCOMING")));

        assertThat(service.getConversations(INSTITUTE, 0, 30, "  ")).hasSize(1);
        assertThat(service.getConversations(INSTITUTE, 0, 30, "NONSENSE")).hasSize(1);
    }
}
