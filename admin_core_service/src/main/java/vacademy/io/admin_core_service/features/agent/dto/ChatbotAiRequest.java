package vacademy.io.admin_core_service.features.agent.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChatbotAiRequest {
    private String instituteId;
    private String modelId;
    private String systemPrompt;
    private List<Map<String, String>> conversationHistory;
    private String userMessage;
    private int maxTokens;
    private double temperature;

    // ── Billing attribution (sent by notification_service's AI_RESPONSE executor) ──
    // The turn is charged to the institute but attributed to the person the bot is
    // talking to, so chatbot spend shows up against a real learner in the AI usage
    // screens instead of as an unattributed system charge. All optional: an unresolved
    // WhatsApp number simply produces an institute-level row.

    /** The platform user behind the conversation, when the number resolved to one. */
    private String userId;

    /** chatbot_flow_session id — groups the turns of one conversation. */
    private String sessionId;

    /** chatbot_flow id — carried as the credit transaction's batch_id, for per-flow rollups. */
    private String flowId;

    /** Flow name, for a readable description on the credit transaction. */
    private String flowName;
}
