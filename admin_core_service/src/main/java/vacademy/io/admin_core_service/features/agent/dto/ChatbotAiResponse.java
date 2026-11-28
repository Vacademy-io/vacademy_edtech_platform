package vacademy.io.admin_core_service.features.agent.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChatbotAiResponse {
    private String assistantMessage;
    private int promptTokens;
    private int completionTokens;
    private boolean exitIntent;

    /**
     * True when the institute cannot pay for this turn — no model was called and
     * {@code assistantMessage} is null. The caller must NOT send this to the learner as
     * an answer; it hands the conversation to a human instead. Distinct from a failure:
     * retrying will not help until the institute tops up.
     */
    private boolean insufficientCredits;

    /**
     * Set together with {@code insufficientCredits} when the pause is an AI usage limit
     * (the institute's per-user / role / chatbot cap), not an empty wallet: topping up will
     * not help, the limit resets on its own. The flow still takes the same pause path.
     */
    private boolean usageLimited;

    /** The limit's own sentence (scope and when it resets) when {@code usageLimited}. */
    private String usageLimitMessage;
}
