package vacademy.io.admin_core_service.features.agent.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.constraints.NotBlank;

/**
 * Request to start or continue an agent conversation
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AgentChatRequest {

    // Session ID for continuing conversation (null for new session)
    private String sessionId;

    @NotBlank(message = "Institute ID is required")
    private String instituteId;

    @NotBlank(message = "Message is required")
    private String message;

    // LLM model the user picked in the frontend. Null/blank = the admin_agent row in
    // ai_model_defaults decides (GLM by default).
    private String model;

    // Optional: Additional context parameters
    private AgentContext context;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AgentContext {
        // TODO: Add more context fields as needed
        private String packageSessionId;
        private String courseId;
        private String userId;
        // Additional context can be added here
    }
}
