package vacademy.io.notification_service.features.chatbot_flow.engine.executors;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.NodeExecutionResult;
import vacademy.io.notification_service.features.chatbot_flow.engine.VariableResolver;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.enums.ChatbotNodeType;

import java.util.List;
import java.util.Map;

/**
 * Sends free-form session messages (text, image, video, document, audio).
 * No pre-approved template needed — works within the 24-hour session window
 * (which is always open because chatbot flows trigger on incoming messages).
 *
 * Config JSON:
 * {
 *   "messageType": "text|image|video|document|audio",
 *   "text": "Hello {{userName}}! Welcome.",
 *   "mediaUrl": "https://example.com/image.jpg",
 *   "mediaCaption": "Check this out!",
 *   "filename": "brochure.pdf",
 *   "variables": [
 *     { "name": "userName", "source": "SYSTEM_FIELD", "field": "full_name", "defaultValue": "Student" },
 *     { "name": "rollNo",   "source": "CUSTOM_FIELD", "field": "Roll Number", "defaultValue": "N/A" }
 *   ]
 * }
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class SendMessageNodeExecutor implements ChatbotNodeExecutor {

    private final ObjectMapper objectMapper;
    private final List<ChatbotMessageProvider> messageProviders;
    private final VariableResolver variableResolver;

    @Override
    public boolean canHandle(String nodeType) {
        return ChatbotNodeType.SEND_MESSAGE.name().equals(nodeType);
    }

    @Override
    public NodeExecutionResult execute(ChatbotFlowNode node, ChatbotFlowSession session,
                                        String userText, FlowExecutionContext context) {
        Map<String, Object> config = parseConfig(node.getConfig());
        if (config == null) {
            return NodeExecutionResult.builder().success(false).errorMessage("Invalid message config").build();
        }

        String messageType = (String) config.getOrDefault("messageType", "text");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> variables = (List<Map<String, Object>>) config.get("variables");

        try {
            ChatbotMessageProvider provider = messageProviders.stream()
                    .filter(p -> p.supports(context.getChannelType()))
                    .findFirst().orElse(null);

            if (provider == null) {
                return NodeExecutionResult.builder()
                        .success(false)
                        .errorMessage("No provider for channel: " + context.getChannelType())
                        .build();
            }

            if ("text".equals(messageType)) {
                String text = (String) config.getOrDefault("text", "");
                String resolved = variableResolver.resolve(text, variables, context);
                log.info("SEND_MESSAGE node: phone={}, rawText=[{}], resolved=[{}], configKeys={}",
                        context.getPhoneNumber(), text, resolved, config.keySet());
                if (resolved == null || resolved.isBlank()) {
                    return NodeExecutionResult.builder()
                            .success(false).errorMessage("Resolved message text is empty").build();
                }
                // Keep the provider's message id: the engine stamps it on the outgoing
                // notification_log row, and it is the only key the delivered/read webhooks join on.
                context.setLastProviderMessageId(
                        provider.sendText(context.getPhoneNumber(), resolved,
                                context.getInstituteId(), context.getBusinessChannelId()));
                log.info("Session text message sent to {}", context.getPhoneNumber());

            } else {
                // Media message: image, video, document, audio
                String mediaUrl = variableResolver.resolve(
                        (String) config.getOrDefault("mediaUrl", ""), variables, context);
                String caption = variableResolver.resolve(
                        (String) config.getOrDefault("mediaCaption", ""), variables, context);
                String filename = (String) config.get("filename");

                if (mediaUrl == null || mediaUrl.isBlank()) {
                    return NodeExecutionResult.builder()
                            .success(false)
                            .errorMessage("Media URL is required for " + messageType + " messages")
                            .build();
                }

                context.setLastProviderMessageId(
                        provider.sendMedia(context.getPhoneNumber(), messageType, mediaUrl, caption,
                                filename, context.getInstituteId(), context.getBusinessChannelId()));
                log.info("Session {} message sent to {}", messageType, context.getPhoneNumber());
            }

            return NodeExecutionResult.builder().success(true).build();

        } catch (Exception e) {
            log.error("Failed to send session message: {}", e.getMessage(), e);
            return NodeExecutionResult.builder()
                    .success(false)
                    .errorMessage("Send failed: " + e.getMessage())
                    .build();
        }
    }

    private Map<String, Object> parseConfig(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return null;
        }
    }
}
