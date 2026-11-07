package vacademy.io.notification_service.features.chatbot_flow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.NodeExecutionResult;
import vacademy.io.notification_service.features.chatbot_flow.engine.VariableResolver;
import vacademy.io.notification_service.features.chatbot_flow.engine.executors.SendMessageNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A bot reply must carry the provider's message id.
 *
 * <p>The delivered/read webhooks join back to an outbound row by that id alone. The chatbot's send
 * nodes used to throw the id away, so every message the bot sent stayed on one grey tick forever —
 * in prod, 57 rows over three days with a NULL source_id and not one of them ever stamped.
 */
class ChatbotSendMessageIdTest {

    private static final String WAMID = "wamid.HBgMOTE5ODc2NTQzMjEwFQIA";

    private ChatbotMessageProvider provider;
    private SendMessageNodeExecutor executor;

    @BeforeEach
    void setUp() {
        provider = mock(ChatbotMessageProvider.class);
        when(provider.supports(anyString())).thenReturn(true);

        VariableResolver resolver = mock(VariableResolver.class);
        when(resolver.resolve(anyString(), any(), any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        executor = new SendMessageNodeExecutor(new ObjectMapper(), List.of(provider), resolver);
    }

    private FlowExecutionContext context() {
        return FlowExecutionContext.builder()
                .phoneNumber("919876543210")
                .instituteId("inst-1")
                .channelType("WHATSAPP_META")
                .build();
    }

    private ChatbotFlowNode textNode() {
        ChatbotFlowNode node = new ChatbotFlowNode();
        node.setId("node-1");
        node.setNodeType("SEND_MESSAGE");
        node.setConfig("{\"messageType\":\"text\",\"text\":\"Hello there\"}");
        return node;
    }

    @Test
    @DisplayName("a text reply keeps the wamid the provider returned")
    void textSendKeepsMessageId() {
        when(provider.sendText(anyString(), anyString(), anyString(), any())).thenReturn(WAMID);
        FlowExecutionContext context = context();

        NodeExecutionResult result =
                executor.execute(textNode(), mock(ChatbotFlowSession.class), "hi", context);

        assertThat(result.isSuccess()).isTrue();
        assertThat(context.getLastProviderMessageId()).isEqualTo(WAMID);
    }

    @Test
    @DisplayName("a media reply keeps its id too")
    void mediaSendKeepsMessageId() {
        when(provider.sendMedia(anyString(), anyString(), anyString(), any(), any(), anyString(), any()))
                .thenReturn(WAMID);
        ChatbotFlowNode node = textNode();
        node.setConfig("{\"messageType\":\"image\",\"mediaUrl\":\"https://example.com/a.png\"}");
        FlowExecutionContext context = context();

        executor.execute(node, mock(ChatbotFlowSession.class), "hi", context);

        assertThat(context.getLastProviderMessageId()).isEqualTo(WAMID);
    }

    @Test
    @DisplayName("a provider that reports no id leaves the field null rather than a stale one")
    void providerWithoutIdClearsTheField() {
        when(provider.sendText(anyString(), anyString(), anyString(), any())).thenReturn(null);
        FlowExecutionContext context = context();
        context.setLastProviderMessageId("wamid.FROM_AN_EARLIER_NODE");

        executor.execute(textNode(), mock(ChatbotFlowSession.class), "hi", context);

        // Inheriting the previous message's id would give this reply another message's ticks.
        assertThat(context.getLastProviderMessageId()).isNull();
    }
}
