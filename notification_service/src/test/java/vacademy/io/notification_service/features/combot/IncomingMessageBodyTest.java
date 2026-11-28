package vacademy.io.notification_service.features.combot;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.notification_service.features.announcements.client.AdminCoreServiceClient;
import vacademy.io.notification_service.features.announcements.service.UserAnnouncementPreferenceService;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotFlowEngine;
import vacademy.io.notification_service.features.combot.action.service.FlowActionRouter;
import vacademy.io.notification_service.features.combot.entity.ChannelToInstituteMapping;
import vacademy.io.notification_service.features.combot.repository.ChannelFlowConfigRepository;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.combot.service.CombotMessagingService;
import vacademy.io.notification_service.features.combot.service.CombotWebhookService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * An inbound message that is not text, a tapped button or a list/button reply used to be stored
 * with an empty body and no payload — the WhatsApp Inbox drew a blank bubble, and nothing on the
 * row said what had actually arrived. These cover the two halves of the fix: a typed placeholder
 * for display, and the raw webhook kept on the row so a future gap is diagnosable.
 *
 * <p>The routing text stays separate on purpose: the flow engine and the opt-in/opt-out keyword
 * checks must never see "[voice note]" as though the user had typed it.
 */
class IncomingMessageBodyTest {

    private static final String CHANNEL_ID = "123456789012345";
    private static final String INSTITUTE_ID = "ca3c4734-7913-48a8-b116-f8f7e0c60eba";

    private NotificationLogRepository notificationLogRepository;
    private ChatbotFlowEngine chatbotFlowEngine;
    private CombotWebhookService service;

    @BeforeEach
    void setUp() {
        notificationLogRepository = mock(NotificationLogRepository.class);
        when(notificationLogRepository.save(any(NotificationLog.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(notificationLogRepository.findTopByChannelIdAndSenderBusinessChannelIdAndNotificationTypeOrderByNotificationDateDesc(
                anyString(), anyString(), anyString())).thenReturn(Optional.empty());

        ChannelToInstituteMappingRepository mappingRepository = mock(ChannelToInstituteMappingRepository.class);
        ChannelToInstituteMapping mapping = new ChannelToInstituteMapping();
        mapping.setChannelId(CHANNEL_ID);
        mapping.setInstituteId(INSTITUTE_ID);
        mapping.setChannelType("COMBOT");
        when(mappingRepository.findById(CHANNEL_ID)).thenReturn(Optional.of(mapping));

        chatbotFlowEngine = mock(ChatbotFlowEngine.class);
        when(chatbotFlowEngine.handleIncomingMessage(anyString(), any(), anyString(), any(),
                anyString(), any(), any(), any(), any())).thenReturn(true);

        service = new CombotWebhookService(
                mock(InternalClientUtils.class),
                notificationLogRepository,
                mappingRepository,
                mock(ChannelFlowConfigRepository.class),
                new ObjectMapper(),
                mock(UserAnnouncementPreferenceService.class),
                mock(FlowActionRouter.class),
                mock(AdminCoreServiceClient.class));
        ReflectionTestUtils.setField(service, "messagingService", mock(CombotMessagingService.class));
        ReflectionTestUtils.setField(service, "chatbotFlowEngine", chatbotFlowEngine);
    }

    /** A Meta Cloud "messages" value block carrying one inbound message. */
    private Map<String, Object> incoming(Map<String, Object> message) {
        return Map.of(
                "messaging_product", "whatsapp",
                "metadata", Map.of("phone_number_id", CHANNEL_ID),
                "contacts", List.of(Map.of(
                        "wa_id", "918130054897",
                        "profile", Map.of("name", "samrendrakumarsinha134"))),
                "messages", List.of(message));
    }

    private NotificationLog processAndCaptureLog(Map<String, Object> message) {
        service.processIncomingMessageFromWebhook(incoming(message), Map.of());
        ArgumentCaptor<NotificationLog> captor = ArgumentCaptor.forClass(NotificationLog.class);
        verify(notificationLogRepository, atLeastOnce()).save(captor.capture());
        return captor.getValue();
    }

    private String routedText() {
        ArgumentCaptor<String> captor = ArgumentCaptor.forClass(String.class);
        verify(chatbotFlowEngine).handleIncomingMessage(anyString(), any(), anyString(), captor.capture(),
                anyString(), any(), any(), any(), any());
        return captor.getValue();
    }

    @Test
    @DisplayName("a plain text message is stored verbatim, as before")
    void plainTextUnchanged() {
        NotificationLog saved = processAndCaptureLog(Map.of(
                "id", "wamid.TEXT", "from", "918130054897", "type", "text",
                "text", Map.of("body", "2")));

        assertThat(saved.getBody()).isEqualTo("2");
        assertThat(routedText()).isEqualTo("2");
    }

    @Test
    @DisplayName("a voice note shows as [voice note] instead of an empty bubble")
    void voiceNoteGetsAPlaceholder() {
        NotificationLog saved = processAndCaptureLog(Map.of(
                "id", "wamid.AUDIO", "from", "918130054897", "type", "audio",
                "audio", Map.of("id", "media-1", "mime_type", "audio/ogg; codecs=opus", "voice", true)));

        assertThat(saved.getBody()).isEqualTo("[voice note]");
        // The flow engine must NOT see the placeholder as user input.
        assertThat(routedText()).isEmpty();
    }

    @Test
    @DisplayName("a document shows its filename")
    void documentShowsFilename() {
        NotificationLog saved = processAndCaptureLog(Map.of(
                "id", "wamid.DOC", "from", "918130054897", "type", "document",
                "document", Map.of("id", "media-2", "filename", "invoice.pdf")));

        assertThat(saved.getBody()).isEqualTo("[document: invoice.pdf]");
    }

    @Test
    @DisplayName("a photo's caption is real user text: it displays AND routes")
    void imageCaptionIsUserText() {
        NotificationLog saved = processAndCaptureLog(Map.of(
                "id", "wamid.IMG", "from", "918130054897", "type", "image",
                "image", Map.of("id", "media-3", "caption", "3")));

        assertThat(saved.getBody()).isEqualTo("3");
        assertThat(routedText()).isEqualTo("3");
    }

    @Test
    @DisplayName("a bare photo still renders as [image]")
    void bareImageGetsAPlaceholder() {
        NotificationLog saved = processAndCaptureLog(Map.of(
                "id", "wamid.IMG2", "from", "918130054897", "type", "image",
                "image", Map.of("id", "media-4")));

        assertThat(saved.getBody()).isEqualTo("[image]");
        assertThat(routedText()).isEmpty();
    }

    @Test
    @DisplayName("an unknown future type is labelled rather than swallowed")
    void unknownTypeIsLabelled() {
        NotificationLog saved = processAndCaptureLog(Map.of(
                "id", "wamid.NEW", "from", "918130054897", "type", "sticker",
                "sticker", Map.of("id", "media-5")));

        assertThat(saved.getBody()).isEqualTo("[sticker]");
    }

    @Test
    @DisplayName("the raw webhook message is kept on the row, so a blank bubble is diagnosable")
    void rawPayloadIsStored() {
        NotificationLog saved = processAndCaptureLog(Map.of(
                "id", "wamid.AUDIO2", "from", "918130054897", "type", "audio",
                "audio", Map.of("id", "media-6", "mime_type", "audio/ogg; codecs=opus", "voice", true)));

        assertThat(saved.getMessagePayload())
                .contains("\"type\":\"audio\"")
                .contains("media-6");
    }

    @Test
    @DisplayName("a list reply keeps its title, and the sender name is still recorded")
    void listReplyUnchanged() {
        NotificationLog saved = processAndCaptureLog(Map.of(
                "id", "wamid.LIST", "from", "918130054897", "type", "interactive",
                "interactive", Map.of("type", "list_reply",
                        "list_reply", Map.of("id", "opt_crm", "title", "CRM"))));

        assertThat(saved.getBody()).isEqualTo("CRM");
        assertThat(saved.getSenderName()).isEqualTo("samrendrakumarsinha134");
        assertThat(routedText()).isEqualTo("CRM");
    }
}
