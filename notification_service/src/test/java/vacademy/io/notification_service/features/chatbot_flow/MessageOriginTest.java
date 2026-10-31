package vacademy.io.notification_service.features.chatbot_flow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.announcements.service.UserAnnouncementPreferenceService;
import vacademy.io.notification_service.features.chatbot_flow.dto.MessageOriginDTO;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotFlowEngine;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.NodeExecutionResult;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlow;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowNodeRepository;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowRepository;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowSessionRepository;
import vacademy.io.notification_service.features.chatbot_flow.repository.NotificationTemplateRepository;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppMessageOriginResolver;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppSendFailureService;
import vacademy.io.notification_service.features.notification_log.MessageOriginPayload;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.repository.SendBatchRepository;
import vacademy.io.notification_service.features.send.service.BatchProcessorService;
import vacademy.io.notification_service.features.send.service.EmailCcResolver;
import vacademy.io.notification_service.features.send.service.UnifiedSendService;
import vacademy.io.notification_service.service.EmailService;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;
import vacademy.io.notification_service.service.WhatsAppService;

import java.lang.reflect.Method;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The Inbox and the student's Communication tab say who sent a WhatsApp message — "workflow X",
 * "chatbot flow Y". SN asked for it on a bot bubble that read only "Template: unlockx_school".
 */
class MessageOriginTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "918379090773";
    private static final Instant SENT_AT = Instant.parse("2026-09-25T12:38:26Z");

    // ==================== Payload helper ====================

    @Test
    @DisplayName("origin rides on params, lands on the payload top level, and leaves bodyParams")
    void originMovesFromParamsToPayload() {
        Map<String, String> params = new HashMap<>(Map.of("1", "Omkar"));
        MessageOriginPayload.putOnParams(params, "WORKFLOW", "wf-1", "UnlockX Registration");

        Map<String, Object> payload = new HashMap<>();
        MessageOriginPayload.liftToPayload(params, payload);

        assertThat(payload).containsEntry("originType", "WORKFLOW")
                .containsEntry("originId", "wf-1")
                .containsEntry("originName", "UnlockX Registration");
        // A resend built from the stored bodyParams must not claim the original sender.
        assertThat(MessageOriginPayload.withoutOrigin(params)).containsExactly(Map.entry("1", "Omkar"));
    }

    @Test
    @DisplayName("no origin type, nothing is added")
    void blankOriginAddsNothing() {
        Map<String, String> params = new HashMap<>();
        MessageOriginPayload.putOnParams(params, null, "wf-1", "x");
        assertThat(params).isEmpty();
    }

    // ==================== Unified send carries the options' origin ====================

    @Test
    @DisplayName("a send with options.originType hands the origin to the log writer with each recipient")
    @SuppressWarnings("unchecked")
    void unifiedSendPutsOriginOnRecipientParams() {
        WhatsAppService whatsAppService = mock(WhatsAppService.class);
        when(whatsAppService.sendWhatsappMessagesDetailed(anyString(), any(), any(), any(), any(), any(),
                anyString(), any(), anyString(), any(), any(), any()))
                .thenReturn(List.of(new WhatsAppService.WhatsAppSendResult(PHONE, true, null, "wamid.1")));
        NotificationTemplateRepository templates = mock(NotificationTemplateRepository.class);
        when(templates.findByInstituteIdAndNameAndLanguage(any(), any(), any())).thenReturn(Optional.empty());
        UnifiedSendService service = new UnifiedSendService(whatsAppService, mock(EmailService.class),
                mock(PushNotificationService.class), mock(SendBatchRepository.class), new ObjectMapper(),
                mock(BatchProcessorService.class), templates, mock(UserAnnouncementPreferenceService.class),
                mock(EmailCcResolver.class), mock(NotificationLogRepository.class));

        service.send(UnifiedSendRequest.builder()
                .instituteId(INSTITUTE)
                .channel("WHATSAPP")
                .templateName("unlockx_registration1")
                .languageCode("en")
                .recipients(List.of(UnifiedSendRequest.Recipient.builder()
                        .phone(PHONE).variables(Map.of("1", "Omkar")).build()))
                .options(UnifiedSendRequest.SendOptions.builder().source("whatsapp-bridge")
                        .originType("WORKFLOW").originId("wf-1").originName("UnlockX Registration").build())
                .build());

        ArgumentCaptor<List<Map<String, Map<String, String>>>> body = ArgumentCaptor.forClass(List.class);
        verify(whatsAppService).sendWhatsappMessagesDetailed(eq("unlockx_registration1"), body.capture(),
                any(), any(), any(), any(), anyString(), any(), anyString(), any(), any(), any());
        assertThat(body.getValue().get(0).get(PHONE))
                .containsEntry("_originType", "WORKFLOW")
                .containsEntry("_originId", "wf-1")
                .containsEntry("_originName", "UnlockX Registration");
    }

    // ==================== Resolver ====================

    private ChatbotFlowRepository flows;
    private ChatbotFlowNodeRepository nodes;
    private ChatbotFlowSessionRepository sessions;
    private WhatsAppMessageOriginResolver resolver;

    @BeforeEach
    void setUp() {
        flows = mock(ChatbotFlowRepository.class);
        nodes = mock(ChatbotFlowNodeRepository.class);
        sessions = mock(ChatbotFlowSessionRepository.class);
        resolver = new WhatsAppMessageOriginResolver(flows, nodes, sessions);
        when(nodes.findByInstituteIdAndNodeType(INSTITUTE, "SEND_TEMPLATE")).thenReturn(List.of());
        when(sessions.findByInstituteIdAndUserPhone(INSTITUTE, PHONE)).thenReturn(List.of());
    }

    private NotificationLog outgoing(String source, String body, String payload) {
        NotificationLog row = new NotificationLog();
        row.setId("log-1");
        row.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
        row.setSource(source);
        row.setBody(body);
        row.setMessagePayload(payload);
        row.setInstituteId(INSTITUTE);
        row.setChannelId(PHONE);
        row.setNotificationDate(SENT_AT);
        return row;
    }

    private void flow(String id, String name) {
        ChatbotFlow f = new ChatbotFlow();
        f.setId(id);
        f.setName(name);
        when(flows.findById(id)).thenReturn(Optional.of(f));
    }

    private ChatbotFlowNode templateNode(String flowId, String templateName) {
        ChatbotFlowNode n = new ChatbotFlowNode();
        n.setFlowId(flowId);
        n.setNodeType("SEND_TEMPLATE");
        n.setConfig("{\"templateName\":\"" + templateName + "\"}");
        return n;
    }

    private ChatbotFlowSession session(String flowId, Instant start, Instant lastActivity) {
        ChatbotFlowSession s = new ChatbotFlowSession();
        s.setFlowId(flowId);
        s.setStartedAt(Timestamp.from(start));
        s.setLastActivityAt(Timestamp.from(lastActivity));
        return s;
    }

    private MessageOriginDTO resolve(NotificationLog row) {
        return resolver.resolve(row, INSTITUTE, resolver.newCache());
    }

    @Test
    @DisplayName("a workflow send reads its workflow's name off the payload")
    void workflowOriginFromPayload() {
        MessageOriginDTO origin = resolve(outgoing("whatsapp-service", "WhatsApp Template: x",
                "{\"templateName\":\"x\",\"originType\":\"WORKFLOW\",\"originId\":\"wf-1\","
                        + "\"originName\":\"UnlockX Registration\"}"));

        assertThat(origin).isEqualTo(new MessageOriginDTO("WORKFLOW", "wf-1", "UnlockX Registration"));
    }

    @Test
    @DisplayName("a new bot row names its flow by the flow's current name")
    void newChatbotRowUsesCurrentFlowName() {
        flow("flow-1", "UnlockX School Promo");

        MessageOriginDTO origin = resolve(outgoing("CHATBOT_FLOW", "Hello",
                "{\"originType\":\"CHATBOT_FLOW\",\"originId\":\"flow-1\"}"));

        assertThat(origin).isEqualTo(new MessageOriginDTO("CHATBOT_FLOW", "flow-1", "UnlockX School Promo"));
    }

    @Test
    @DisplayName("an old bot template row is matched to the one flow that sends that template")
    void legacyTemplateRowMatchedByTemplate() {
        flow("flow-1", "New Flow");
        when(nodes.findByInstituteIdAndNodeType(INSTITUTE, "SEND_TEMPLATE"))
                .thenReturn(List.of(templateNode("flow-1", "unlockx_school"), templateNode("flow-2", "other")));

        MessageOriginDTO origin = resolve(outgoing("CHATBOT_FLOW", "Template: unlockx_school", null));

        assertThat(origin).isEqualTo(new MessageOriginDTO("CHATBOT_FLOW", "flow-1", "New Flow"));
    }

    @Test
    @DisplayName("an old bot text row is matched by the session open for that phone at the time")
    void legacyTextRowMatchedBySession() {
        flow("flow-2", "Challenge Confirmation");
        when(sessions.findByInstituteIdAndUserPhone(INSTITUTE, PHONE)).thenReturn(List.of(
                session("flow-1", SENT_AT.minusSeconds(7200), SENT_AT.minusSeconds(3600)), // long over
                session("flow-2", SENT_AT.minusSeconds(60), SENT_AT.plusSeconds(1))));

        MessageOriginDTO origin = resolve(outgoing("CHATBOT_FLOW", "Welcome!", null));

        assertThat(origin).isEqualTo(new MessageOriginDTO("CHATBOT_FLOW", "flow-2", "Challenge Confirmation"));
    }

    @Test
    @DisplayName("two flows open at once: still \"chatbot flow\", but no guessed name")
    void ambiguousLegacyRowHasNoName() {
        when(sessions.findByInstituteIdAndUserPhone(INSTITUTE, PHONE)).thenReturn(List.of(
                session("flow-1", SENT_AT.minusSeconds(60), SENT_AT.plusSeconds(1)),
                session("flow-2", SENT_AT.minusSeconds(30), SENT_AT.plusSeconds(1))));

        MessageOriginDTO origin = resolve(outgoing("CHATBOT_FLOW", "Welcome!", null));

        assertThat(origin).isEqualTo(new MessageOriginDTO("CHATBOT_FLOW", null, null));
    }

    @Test
    @DisplayName("incoming messages and untraced sends get no origin")
    void noOriginWhereNothingIsKnown() {
        NotificationLog incoming = outgoing("whatsapp-service", "Hi", null);
        incoming.setNotificationType("WHATSAPP_MESSAGE_INCOMING");

        assertThat(resolve(incoming)).isNull();
        assertThat(resolve(outgoing("whatsapp-service", "WhatsApp Template: x", "{\"templateName\":\"x\"}")))
                .isNull();
    }

    // ==================== The bot records its flow ====================

    private ChatbotFlowNode flowNode() {
        ChatbotFlowNode node = new ChatbotFlowNode();
        node.setId("node-1");
        node.setFlowId("flow-1");
        node.setNodeType("SEND_MESSAGE");
        node.setConfig("{\"messageType\":\"text\",\"text\":\"Welcome!\"}");
        return node;
    }

    private FlowExecutionContext context() {
        return FlowExecutionContext.builder().phoneNumber(PHONE).instituteId(INSTITUTE)
                .channelType("WHATSAPP_META").build();
    }

    @Test
    @DisplayName("every bot message is logged with the flow that sent it")
    void engineStampsFlowOnEveryRow() throws Exception {
        NotificationLogRepository logRepository = mock(NotificationLogRepository.class);
        ChatbotFlowEngine engine = new ChatbotFlowEngine(null, null, null, null, null, logRepository,
                List.of(), new ObjectMapper(), null, mock(WhatsAppSendFailureService.class));

        Method logOutgoing = ChatbotFlowEngine.class.getDeclaredMethod("logOutgoingMessage",
                ChatbotFlowNode.class, FlowExecutionContext.class, NodeExecutionResult.class);
        logOutgoing.setAccessible(true);
        logOutgoing.invoke(engine, flowNode(), context(), NodeExecutionResult.builder().success(true).build());

        ArgumentCaptor<NotificationLog> saved = ArgumentCaptor.forClass(NotificationLog.class);
        verify(logRepository).save(saved.capture());
        assertThat(saved.getValue().getBody()).isEqualTo("Welcome!");
        assertThat(saved.getValue().getMessagePayload())
                .isEqualTo("{\"originType\":\"CHATBOT_FLOW\",\"originId\":\"flow-1\"}");
    }

    @Test
    @DisplayName("a refused bot message keeps its flow too")
    void engineStampsFlowOnFailedRow() throws Exception {
        WhatsAppSendFailureService failureService = mock(WhatsAppSendFailureService.class);
        ChatbotFlowEngine engine = new ChatbotFlowEngine(null, null, null, null, null,
                mock(NotificationLogRepository.class), List.of(), new ObjectMapper(), null, failureService);

        Method logFailed = ChatbotFlowEngine.class.getDeclaredMethod("logFailedOutgoingMessage",
                ChatbotFlowNode.class, FlowExecutionContext.class, String.class);
        logFailed.setAccessible(true);
        logFailed.invoke(engine, flowNode(), context(), "boom");

        verify(failureService).logFailure(eq(INSTITUTE), eq(PHONE), any(), any(), eq("text"), eq("Welcome!"),
                eq("CHATBOT_FLOW"), eq("boom"),
                eq(Map.of("originType", "CHATBOT_FLOW", "originId", "flow-1")));
    }
}
