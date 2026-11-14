package vacademy.io.notification_service.features.chatbot_flow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxMessageDTO;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.service.ChatbotEscalationService;
import vacademy.io.notification_service.features.chatbot_flow.service.InboundWhatsAppMessage;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * What the Inbox shows for a learner's sticker, reaction, photo or voice note, and why a failed
 * message says why. Payloads below are the three shapes production stores, trimmed.
 */
class WhatsAppInboxInboundContentTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "919800000001";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Com.bot / Meta path: one Cloud API message object. */
    private static final String COMBOT_REACTION = """
            {"from":"919800000001","id":"wamid.IN1","type":"reaction",
             "reaction":{"message_id":"wamid.OUT1","emoji":"👍🏻"}}""";
    private static final String COMBOT_STICKER = """
            {"from":"919800000002","id":"wamid.IN2","type":"sticker",
             "sticker":{"mime_type":"image/webp","id":"media-123","animated":false}}""";
    /** Meta unified webhook path: the whole envelope. */
    private static final String META_ENVELOPE_VOICE = """
            {"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[
              {"from":"919800000003","id":"wamid.IN3","type":"audio",
               "audio":{"mime_type":"audio/ogg; codecs=opus","id":"555","voice":true}}]}}]}]}""";
    /** WATI path. */
    private static final String WATI_IMAGE = """
            {"id":"6ad2","whatsappMessageId":"wamid.IN4","text":"see this","type":"image",
             "data":"https://live-mt-server.wati.io/100000/api/file/showFile?fileName=data/images/a.jpg",
             "eventType":"message","owner":false,"waId":"91"}""";
    private static final String WATI_TEMPLATE_FAILED = """
            {"eventType":"templateMessageFailed","failedCode":"100",
             "failedDetail":"Missing information - please check template media or contact information",
             "type":"template","text":null}""";

    private NotificationLogRepository logRepository;
    private WhatsAppTemplateRenderer renderer;
    private WhatsAppInboxService service;

    @BeforeEach
    void setUp() {
        logRepository = mock(NotificationLogRepository.class);
        renderer = mock(WhatsAppTemplateRenderer.class);
        when(renderer.newCache()).thenReturn(new HashMap<>());
        service = new WhatsAppInboxService(logRepository, mock(ChannelToInstituteMappingRepository.class),
                renderer, mock(ChatbotEscalationService.class), mock(WhatsAppSendFailureService.class),
                new WhatsAppMediaPolicy(), MAPPER, List.of(mock(ChatbotMessageProvider.class)));
    }

    private static NotificationLog incoming(String id, String body, String payload) {
        NotificationLog row = new NotificationLog();
        row.setId(id);
        row.setNotificationType("WHATSAPP_MESSAGE_INCOMING");
        row.setChannelId(PHONE);
        row.setInstituteId(INSTITUTE);
        row.setBody(body);
        row.setMessagePayload(payload);
        row.setNotificationDate(Instant.now());
        return row;
    }

    private static NotificationLog outgoing(String id, String wamid) {
        NotificationLog row = new NotificationLog();
        row.setId(id);
        row.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
        row.setChannelId(PHONE);
        row.setInstituteId(INSTITUTE);
        row.setSourceId(wamid);
        row.setBody("WhatsApp Template: course_launch");
        row.setNotificationDate(Instant.now());
        return row;
    }

    private void thread(NotificationLog... rows) {
        when(logRepository.findMessagesForPhone(eq(PHONE), eq(INSTITUTE), any(), any(Integer.class)))
                .thenReturn(List.of(rows));
    }

    @Test
    @DisplayName("A reaction is tied to the message it was on, not shown as \"[reaction: 👍]\"")
    void reactionPointsAtItsTarget() {
        NotificationLog target = outgoing("out-1", "wamid.OUT1");
        thread(incoming("in-1", "[reaction: 👍🏻]", COMBOT_REACTION), target);
        when(logRepository.findOutgoingBySourceIds(eq(INSTITUTE), any())).thenReturn(List.of(target));
        when(renderer.displayBody(eq(target), anyString(), any())).thenReturn("Attend for at least 30 minutes");

        InboxMessageDTO reaction = service.getMessages(PHONE, INSTITUTE, null, 50).get(0);

        assertThat(reaction.getMessageKind()).isEqualTo("reaction");
        assertThat(reaction.getReactionEmoji()).isEqualTo("👍🏻");
        assertThat(reaction.getReactedToMessageId()).isEqualTo("out-1");
        assertThat(reaction.getReactedToPreview()).isEqualTo("Attend for at least 30 minutes");
        assertThat(reaction.getBody()).isNull();
    }

    @Test
    @DisplayName("A sticker becomes a fetchable image, not the text \"[sticker]\"")
    void stickerIsFetchableMedia() {
        thread(incoming("in-2", "[sticker]", COMBOT_STICKER));

        InboxMessageDTO sticker = service.getMessages(PHONE, INSTITUTE, null, 50).get(0);

        assertThat(sticker.getMessageKind()).isEqualTo("sticker");
        assertThat(sticker.getMediaType()).isEqualTo("sticker");
        assertThat(sticker.getMediaFetchable()).isTrue();
        assertThat(sticker.getBody()).isNull();
    }

    @Test
    @DisplayName("WATI's report of our own failed template is drawn as ours, with its reason")
    void watiTemplateFailureIsOurs() {
        thread(incoming("in-3", null, WATI_TEMPLATE_FAILED));

        InboxMessageDTO msg = service.getMessages(PHONE, INSTITUTE, null, 50).get(0);

        assertThat(msg.getDirection()).isEqualTo("OUTGOING");
        assertThat(msg.getDeliveryStatus()).isEqualTo("FAILED");
        assertThat(msg.getError()).isEqualTo(
                "Missing information - please check template media or contact information (100)");
    }

    @Test
    @DisplayName("A FAILED row that lost its reason gets it back from the failure event")
    void failureReasonRecoveredFromEvent() {
        NotificationLog failed = outgoing("out-2", "wamid.OUT2");
        failed.setDeliveryStatus("FAILED");
        thread(failed);
        when(logRepository.findFailureEventsBySourceIds(eq(PHONE), any())).thenReturn(List.<Object[]>of(
                new Object[]{"wamid.OUT2", "Status: failed", null, null},
                new Object[]{"wamid.OUT2", "Error: Message undeliverable (code=131026)", null, null}));

        InboxMessageDTO msg = service.getMessages(PHONE, INSTITUTE, null, 50).get(0);

        assertThat(msg.getDeliveryStatus()).isEqualTo("FAILED");
        assertThat(msg.getError()).isEqualTo("Message undeliverable (131026)");
    }

    @Test
    @DisplayName("No reason anywhere → null, so the UI does not print \"Not delivered\" twice")
    void noReasonIsNull() {
        NotificationLog failed = outgoing("out-3", "wamid.OUT3");
        failed.setDeliveryStatus("FAILED");
        thread(failed);
        when(logRepository.findFailureEventsBySourceIds(eq(PHONE), any())).thenReturn(List.of());

        assertThat(service.getMessages(PHONE, INSTITUTE, null, 50).get(0).getError()).isNull();
    }

    @Test
    @DisplayName("Parser reads the Meta envelope and WATI shapes")
    void parserShapes() {
        InboundWhatsAppMessage voice = InboundWhatsAppMessage.parse(META_ENVELOPE_VOICE, MAPPER);
        assertThat(voice.kind()).isEqualTo("voice");
        assertThat(voice.mediaRef()).isEqualTo("555");
        assertThat(voice.mediaSource()).isEqualTo("META");

        InboundWhatsAppMessage image = InboundWhatsAppMessage.parse(WATI_IMAGE, MAPPER);
        assertThat(image.kind()).isEqualTo("image");
        assertThat(image.mediaSource()).isEqualTo("WATI");
        assertThat(image.text()).isEqualTo("see this");
        assertThat(image.hasMedia()).isTrue();

        assertThat(InboundWhatsAppMessage.parse("not json", MAPPER)).isNull();
        assertThat(InboundWhatsAppMessage.parse(null, MAPPER)).isNull();
    }
}
