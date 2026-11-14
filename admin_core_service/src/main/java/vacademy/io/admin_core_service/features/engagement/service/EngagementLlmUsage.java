package vacademy.io.admin_core_service.features.engagement.service;

import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;

import java.math.BigDecimal;

/**
 * Tokens (and their USD price) spent by the brain call(s) behind ONE decision, summed across the
 * strict-JSON retry. Engagement is billed per sent message, so this is what the daily report reads
 * to show what the engine's thinking cost — including the decisions to wait.
 */
public record EngagementLlmUsage(int tokensIn, int tokensOut, String model, BigDecimal costUsd) {

    public static final EngagementLlmUsage NONE = new EngagementLlmUsage(0, 0, null, null);

    /** This usage plus one LLM response, priced per response (a failover can change the model). */
    public EngagementLlmUsage plus(LLMService.LLMResponse resp, EngagementLlmPricing pricing) {
        if (resp == null) {
            return this;
        }
        int in = Math.max(0, resp.getPromptTokens());
        int out = Math.max(0, resp.getCompletionTokens());
        BigDecimal cost = pricing != null ? pricing.costUsd(resp.getModelUsed(), in, out) : null;
        return new EngagementLlmUsage(tokensIn + in, tokensOut + out,
                resp.getModelUsed() != null ? resp.getModelUsed() : model,
                cost == null ? costUsd : (costUsd == null ? cost : costUsd.add(cost)));
    }

    public boolean isEmpty() {
        return tokensIn == 0 && tokensOut == 0;
    }

    /** Stamps this usage on the action its decision produced. Null or empty usage leaves it untouched. */
    public static void applyTo(EngagementLlmUsage usage, EngagementAction action) {
        if (usage == null || usage.isEmpty() || action == null) {
            return;
        }
        action.setLlmTokensIn(usage.tokensIn());
        action.setLlmTokensOut(usage.tokensOut());
        action.setLlmModel(usage.model());
        action.setLlmCostUsd(usage.costUsd());
    }
}
