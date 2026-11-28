package vacademy.io.notification_service.features.chatbot_flow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxTemplateButtonDTO;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotFlowEngine;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.NodeExecutionResult;
import vacademy.io.notification_service.features.chatbot_flow.engine.VariableResolver;
import vacademy.io.notification_service.features.chatbot_flow.engine.executors.SendTemplateNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.entity.NotificationTemplate;
import vacademy.io.notification_service.features.chatbot_flow.repository.NotificationTemplateRepository;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppSendFailureService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppTemplateRenderer;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A template the chatbot sends must show up in the WhatsApp Inbox as the message the learner got —
 * header image, body, buttons — not as the bare line "Template: unlockx_school".
 *
 * <p>The bot used to log only that line, with no payload, so the renderer had nothing to rebuild
 * from: 227 prod rows across two institutes read that way (SN's unlockx_school among them).
 */
class ChatbotTemplateInboxRenderTest {

    private static final String INSTITUTE = "inst-1";
    private static final String SAMPLE_IMAGE = "https://cdn.example.com/sample.jpeg";
    private static final String SENT_IMAGE = "https://cdn.example.com/sent.jpeg";

    private NotificationTemplateRepository templateRepository;
    private WhatsAppTemplateRenderer renderer;

    @BeforeEach
    void setUp() {
        templateRepository = mock(NotificationTemplateRepository.class);
        renderer = new WhatsAppTemplateRenderer(templateRepository);
    }

    private void templates(NotificationTemplate... templates) {
        when(templateRepository.findByInstituteIdOrderByUpdatedAtDesc(INSTITUTE)).thenReturn(List.of(templates));
    }

    private NotificationTemplate unlockxSchool() {
        return NotificationTemplate.builder()
                .instituteId(INSTITUTE)
                .name("unlockx_school")
                .language("en")
                .headerType("IMAGE")
                .headerSampleUrl(SAMPLE_IMAGE)
                .bodyText("Dear Students & Parents,\n\nRegistrations are now open.")
                .buttonsConfig("[{\"type\":\"URL\",\"text\":\"REGISTER FOR FREE\","
                        + "\"url\":\"https://1kb.link/aivf5b\",\"phoneNumber\":null,\"example\":null}]")
                .build();
    }

    private NotificationLog chatbotRow(String body, String payload) {
        NotificationLog row = new NotificationLog();
        row.setId("log-1");
        row.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
        row.setSource("CHATBOT_FLOW");
        row.setInstituteId(INSTITUTE);
        row.setBody(body);
        row.setMessagePayload(payload);
        return row;
    }

    @Test
    @DisplayName("an old bot row with only \"Template: name\" renders the template it names")
    void legacyChatbotRowRendersTemplate() {
        templates(unlockxSchool());

        WhatsAppTemplateRenderer.Rendered rm =
                renderer.render(chatbotRow("Template: unlockx_school", null), INSTITUTE, renderer.newCache());

        assertThat(rm).isNotNull();
        assertThat(rm.templateName).isEqualTo("unlockx_school");
        assertThat(rm.body).isEqualTo("Dear Students & Parents,\n\nRegistrations are now open.");
        assertThat(rm.deliveryStatus).isEqualTo("SUCCESS");
        assertThat(rm.headerType).isEqualTo("IMAGE");
        assertThat(rm.headerMediaUrl).isEqualTo(SAMPLE_IMAGE);
        assertThat(rm.buttons).extracting(InboxTemplateButtonDTO::getText, InboxTemplateButtonDTO::getUrl)
                .containsExactly(tuple("REGISTER FOR FREE", "https://1kb.link/aivf5b"));
    }

    @Test
    @DisplayName("an old refused bot send still reads FAILED, with the template it tried")
    void legacyRefusedChatbotRowStaysFailed() {
        templates(unlockxSchool());
        String payload = "{\"deliveryStatus\":\"FAILED\",\"error\":\"Re-engagement message (131047)\","
                + "\"attemptedType\":\"template\"}";

        WhatsAppTemplateRenderer.Rendered rm =
                renderer.render(chatbotRow("Template: unlockx_school", payload), INSTITUTE, renderer.newCache());

        assertThat(rm.deliveryStatus).isEqualTo("FAILED");
        assertThat(rm.error).isEqualTo("Re-engagement message (131047)");
        assertThat(rm.body).startsWith("Dear Students");
    }

    @Test
    @DisplayName("\"Template: \" text from anyone but the bot is left alone")
    void onlyChatbotRowsAreReadAsTemplates() {
        templates(unlockxSchool());
        NotificationLog row = chatbotRow("Template: unlockx_school", null);
        row.setSource("INBOX");

        assertThat(renderer.render(row, INSTITUTE, renderer.newCache())).isNull();
    }

    @Test
    @DisplayName("a new bot row fills params, uses the image it actually sent, and fills URL suffixes")
    void newChatbotRowUsesSentValues() {
        NotificationTemplate tmpl = unlockxSchool();
        tmpl.setBodyText("Hi {{1}}, your code is {{2}}.");
        tmpl.setButtonsConfig("[{\"type\":\"QUICK_REPLY\",\"text\":\"\"},"
                + "{\"type\":\"URL\",\"text\":\"Open\",\"url\":\"https://x.example/r/{{1}}\"},"
                + "{\"type\":\"URL\",\"text\":\"Unfilled\",\"url\":\"https://x.example/u/{{1}}\"},"
                + "{\"type\":\"URL\",\"text\":\"Script\",\"url\":\"javascript:alert(1)\"}]");
        templates(tmpl);
        String payload = "{\"templateName\":\"unlockx_school\",\"languageCode\":\"en\","
                + "\"bodyParams\":{\"1\":\"Omkar\",\"2\":\"X42\"},\"headerType\":\"image\","
                + "\"headerParams\":{\"link\":\"" + SENT_IMAGE + "\"},\"buttonParams\":{\"1\":\"abc\"}}";

        WhatsAppTemplateRenderer.Rendered rm =
                renderer.render(chatbotRow("Template: unlockx_school", payload), INSTITUTE, renderer.newCache());

        assertThat(rm.body).isEqualTo("Hi Omkar, your code is X42.");
        assertThat(rm.headerMediaUrl).isEqualTo(SENT_IMAGE);
        // Blank quick reply dropped; unfillable and non-http links shown as labels, not links.
        assertThat(rm.buttons).extracting(InboxTemplateButtonDTO::getText, InboxTemplateButtonDTO::getUrl)
                .containsExactly(
                        tuple("Open", "https://x.example/r/abc"),
                        tuple("Unfilled", null),
                        tuple("Script", null));
    }

    // ==================== The bot keeps what it sent ====================

    private SendTemplateNodeExecutor executor(ChatbotMessageProvider provider) {
        VariableResolver resolver = mock(VariableResolver.class);
        when(resolver.resolve(anyString(), any(), any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(provider.supports(anyString())).thenReturn(true);
        return new SendTemplateNodeExecutor(new ObjectMapper(), List.of(provider), resolver);
    }

    private ChatbotFlowNode templateNode() {
        ChatbotFlowNode node = new ChatbotFlowNode();
        node.setId("node-1");
        node.setNodeType("SEND_TEMPLATE");
        node.setConfig("{\"templateName\":\"unlockx_school\",\"languageCode\":\"en\","
                + "\"bodyParams\":[{\"index\":2,\"value\":\"X42\"},{\"index\":1,\"value\":\"Omkar\"}],"
                + "\"headerConfig\":{\"type\":\"image\",\"url\":\"" + SENT_IMAGE + "\",\"filename\":\"\"},"
                + "\"buttonConfig\":[{\"type\":\"url\",\"index\":1,\"urlSuffix\":\"abc\"}],\"variables\":[]}");
        return node;
    }

    private FlowExecutionContext context() {
        return FlowExecutionContext.builder()
                .phoneNumber("918379090773")
                .instituteId(INSTITUTE)
                .channelType("WHATSAPP_META")
                .build();
    }

    @Test
    @DisplayName("the template node records the send in the shape the renderer reads")
    void executorRecordsTemplateSend() {
        ChatbotMessageProvider provider = mock(ChatbotMessageProvider.class);
        when(provider.sendTemplate(anyString(), any(), anyString(), any())).thenReturn("wamid.1");
        FlowExecutionContext context = context();

        executor(provider).execute(templateNode(), mock(ChatbotFlowSession.class), "hi", context);

        Map<String, Object> record = context.getLastTemplateSend();
        assertThat(record).containsEntry("templateName", "unlockx_school")
                .containsEntry("bodyParams", Map.of("1", "Omkar", "2", "X42"))
                .containsEntry("headerType", "image")
                .containsEntry("headerParams", Map.of("link", SENT_IMAGE))
                .containsEntry("buttonParams", Map.of("1", "abc"));
    }

    @Test
    @DisplayName("a refused template send still records which template it was")
    void refusedSendStillRecordsTemplate() {
        ChatbotMessageProvider provider = mock(ChatbotMessageProvider.class);
        when(provider.sendTemplate(anyString(), any(), anyString(), any()))
                .thenThrow(new RuntimeException("(#131047) Re-engagement message"));
        FlowExecutionContext context = context();

        NodeExecutionResult result =
                executor(provider).execute(templateNode(), mock(ChatbotFlowSession.class), "hi", context);

        assertThat(result.isSuccess()).isFalse();
        assertThat(context.getLastTemplateSend()).containsEntry("templateName", "unlockx_school");
    }

    @Test
    @DisplayName("the engine writes the send onto the Inbox row, and clears it for the next node")
    void engineStoresTemplateSendOnOutgoingRow() throws Exception {
        NotificationLogRepository logRepository = mock(NotificationLogRepository.class);
        ChatbotFlowEngine engine = new ChatbotFlowEngine(null, null, null, null, null, logRepository,
                List.of(), new ObjectMapper(), null, mock(WhatsAppSendFailureService.class));
        FlowExecutionContext context = context();
        context.setLastTemplateSend(Map.of("templateName", "unlockx_school"));

        Method logOutgoing = ChatbotFlowEngine.class.getDeclaredMethod("logOutgoingMessage",
                ChatbotFlowNode.class, FlowExecutionContext.class, NodeExecutionResult.class);
        logOutgoing.setAccessible(true);
        logOutgoing.invoke(engine, templateNode(), context, NodeExecutionResult.builder().success(true).build());

        ArgumentCaptor<NotificationLog> saved = ArgumentCaptor.forClass(NotificationLog.class);
        verify(logRepository).save(saved.capture());
        assertThat(saved.getValue().getBody()).isEqualTo("Template: unlockx_school");
        assertThat(saved.getValue().getMessagePayload()).isEqualTo("{\"templateName\":\"unlockx_school\"}");
        assertThat(context.getLastTemplateSend()).isNull();
    }

    @Test
    @DisplayName("a refused bot template is logged FAILED with the template kept on the payload")
    void engineKeepsTemplateOnFailedRow() throws Exception {
        WhatsAppSendFailureService failureService = mock(WhatsAppSendFailureService.class);
        ChatbotFlowEngine engine = new ChatbotFlowEngine(null, null, null, null, null,
                mock(NotificationLogRepository.class), List.of(), new ObjectMapper(), null, failureService);
        FlowExecutionContext context = context();
        Map<String, Object> send = Map.of("templateName", "unlockx_school");
        context.setLastTemplateSend(send);

        Method logFailed = ChatbotFlowEngine.class.getDeclaredMethod("logFailedOutgoingMessage",
                ChatbotFlowNode.class, FlowExecutionContext.class, String.class);
        logFailed.setAccessible(true);
        logFailed.invoke(engine, templateNode(), context, "boom");

        verify(failureService).logFailure(eq(INSTITUTE), eq("918379090773"), any(), any(),
                eq("template"), eq("Template: unlockx_school"), eq("CHATBOT_FLOW"), eq("boom"), eq(send));
        assertThat(context.getLastTemplateSend()).isNull();
    }
}
