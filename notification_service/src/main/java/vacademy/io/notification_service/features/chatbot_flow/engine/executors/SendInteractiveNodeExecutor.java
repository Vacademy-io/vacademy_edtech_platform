package vacademy.io.notification_service.features.chatbot_flow.engine.executors;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.NodeExecutionResult;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.enums.ChatbotNodeType;

import java.util.List;
import java.util.Map;

@Component
@Slf4j
@RequiredArgsConstructor
public class SendInteractiveNodeExecutor implements ChatbotNodeExecutor {

    private final ObjectMapper objectMapper;
    private final List<ChatbotMessageProvider> messageProviders;

    @Override
    public boolean canHandle(String nodeType) {
        return ChatbotNodeType.SEND_INTERACTIVE.name().equals(nodeType);
    }

    @Override
    public NodeExecutionResult execute(ChatbotFlowNode node, ChatbotFlowSession session,
                                        String userText, FlowExecutionContext context) {
        Map<String, Object> config = parseConfig(node.getConfig());
        if (config == null) {
            return NodeExecutionResult.builder().success(false).errorMessage("Invalid interactive config").build();
        }

        // Validate body text is present — WATI rejects empty body
        String body = (String) config.get("body");
        if (body == null || body.isBlank()) {
            log.error("SEND_INTERACTIVE node has empty body text — nodeId={}", node.getId());
            return NodeExecutionResult.builder()
                    .success(false)
                    .errorMessage("Interactive message body text is required")
                    .build();
        }

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

            // Keep the provider's message id — the engine stamps it on the outgoing row, and it
            // is the only key the delivered/read webhooks can join on.
            context.setLastProviderMessageId(
                    provider.sendInteractive(context.getPhoneNumber(), config,
                            context.getInstituteId(), context.getBusinessChannelId()));

            log.info("Interactive message sent: type={}, phone={}",
                    config.get("interactiveType"), context.getPhoneNumber());
            return NodeExecutionResult.builder().success(true).build();

        } catch (Exception e) {
            log.error("Failed to send interactive message: {}", e.getMessage());

            // 24hr window fallback: try sending fallback template if configured
            String fallbackTemplate = (String) config.get("fallbackTemplateName");
            if (fallbackTemplate != null && !fallbackTemplate.isBlank()
                    && e.getMessage() != null && e.getMessage().contains("131047")) {
                log.info("24hr window expired, sending fallback template: {}", fallbackTemplate);
                try {
                    ChatbotMessageProvider provider = messageProviders.stream()
                            .filter(p -> p.supports(context.getChannelType()))
                            .findFirst().orElse(null);
                    if (provider != null) {
                        context.setLastProviderMessageId(
                                provider.sendTemplate(context.getPhoneNumber(),
                                        Map.of("templateName", fallbackTemplate, "languageCode", "en", "bodyParams", List.of()),
                                        context.getInstituteId(), context.getBusinessChannelId()));
                        return NodeExecutionResult.builder().success(true).build();
                    }
                } catch (Exception fallbackEx) {
                    log.error("Fallback template also failed: {}", fallbackEx.getMessage());
                }
            }

            return NodeExecutionResult.builder()
                    .success(false)
                    .errorMessage("Interactive send failed: " + e.getMessage())
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
