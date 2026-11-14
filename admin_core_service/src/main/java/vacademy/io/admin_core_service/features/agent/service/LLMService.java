package vacademy.io.admin_core_service.features.agent.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.agent.dto.ConversationSession;
import vacademy.io.admin_core_service.features.ai_models.service.AiModelDefaultsResolver;
import vacademy.io.admin_core_service.features.ai_models.service.LlmGatewayRouter;
import vacademy.io.admin_core_service.features.ai_usage.enums.ApiProvider;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.ai_usage.service.AiTokenUsageService;
import vacademy.io.admin_core_service.features.ai_usage.service.JavaLlmBillingService;

import java.time.Duration;
import java.util.*;

/**
 * Chat completions with tool calling, for the admin agent, the Automations chatbot, the
 * Engagement Engine, the workflow drafter and the voice-agent prompt assistant.
 *
 * <p>The model comes from the caller's use case in ai_model_defaults
 * ({@link #CTX_USE_CASE}, default {@code admin_agent}); an explicit
 * {@link ConversationSession#getModel()} still wins and keeps the use case's chain behind it
 * as failover. Calls go through {@link LlmGatewayRouter} (Isoquant for routed models, the
 * same model on OpenRouter when the gateway fails, then the next model), and usage is
 * recorded under the registry id that actually answered ({@link LLMResponse#getModelUsed()}).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LLMService {

    /** Use case when the caller names none: the admin agent (AgentOrchestrator). */
    public static final String DEFAULT_USE_CASE = "admin_agent";

    /**
     * Per-attempt timeout. Large drafts (16k completion tokens) legitimately run for
     * minutes; the frontend aborts at 150s, so the default sits just above that.
     */
    private static final Duration ATTEMPT_TIMEOUT = Duration.ofSeconds(160);
    /** For background jobs only ({@link #CTX_LONG_RUNNING}): no request thread is waiting. */
    private static final Duration LONG_ATTEMPT_TIMEOUT = Duration.ofSeconds(600);

    private final ObjectMapper objectMapper;
    private final AiTokenUsageService aiTokenUsageService;
    private final LlmGatewayRouter gatewayRouter;
    private final AiModelDefaultsResolver modelDefaults;

    /**
     * Charges calls no caller bills, behind billing.java_agent_charge (default off). Field
     * injection keeps the constructor as it was; null (unit tests) = record only, as before.
     */
    @Autowired(required = false)
    @Lazy
    private JavaLlmBillingService llmBilling;

    /**
     * Generate a chat completion with tool calling support
     */
    public LLMResponse generateChatCompletion(ConversationSession session) {
        log.info("[LLMService] Generating chat completion for session: {}", session.getSessionId());

        Map<String, Object> ctx = session.getContext();
        List<String> chain = modelChain(session);
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = objectMapper.convertValue(buildChatRequest(session), Map.class);

            log.debug("[LLMService] chain={} request={}", chain, payload);

            boolean longRunning = ctx != null && Boolean.TRUE.equals(ctx.get(CTX_LONG_RUNNING));
            Duration attemptTimeout = ctx != null && ctx.get(CTX_ATTEMPT_TIMEOUT) instanceof Duration d
                    ? d : (longRunning ? LONG_ATTEMPT_TIMEOUT : ATTEMPT_TIMEOUT);
            Duration budget = ctx != null && ctx.get(CTX_TIME_BUDGET) instanceof Duration b ? b : null;
            String effort = ctx != null && ctx.get(CTX_REASONING_EFFORT) instanceof String e && !e.isBlank()
                    ? e : null;

            LlmGatewayRouter.LlmResult result = gatewayRouter.chat(chain, payload, attemptTimeout, effort, budget);

            LLMResponse llmResponse = parseResponse(result.body());
            llmResponse.setModelUsed(result.modelId());

            // Record the usage row (async by default; see logTokenUsage for the
            // synchronous variant callers that need to BILL the call opt into)
            logTokenUsage(llmResponse, session);

            return llmResponse;

        } catch (Exception e) {
            log.error("[LLMService] Error generating chat completion (chain {}): {}", chain, e.getMessage(), e);
            throw new RuntimeException("Failed to generate chat completion: " + e.getMessage(), e);
        }
    }

    /**
     * The models to try, in order. An explicit session model goes first (it is a user or
     * operator pick) unless {@link #CTX_NO_FAILOVER} says the caller runs its own fallback.
     */
    List<String> modelChain(ConversationSession session) {
        Map<String, Object> ctx = session.getContext();
        String useCase = ctx != null && ctx.get(CTX_USE_CASE) instanceof String u && !u.isBlank()
                ? u : DEFAULT_USE_CASE;
        String explicit = session.getModel();
        boolean hasExplicit = explicit != null && !explicit.isBlank();
        if (hasExplicit && ctx != null && Boolean.TRUE.equals(ctx.get(CTX_NO_FAILOVER))) {
            return List.of(explicit.trim());
        }
        AiModelDefaultsResolver.ModelChain chain = modelDefaults.resolve(useCase);
        return hasExplicit ? chain.withPreferred(explicit).models() : chain.models();
    }

    /**
     * Context key (String): the ai_model_defaults use case whose chain serves this call.
     * Absent = {@link #DEFAULT_USE_CASE}.
     */
    public static final String CTX_USE_CASE = "use_case";

    /**
     * Context flag (Boolean TRUE): try only the session's explicit model, no chain behind it.
     * For callers that run their own primary/fallback loop.
     */
    public static final String CTX_NO_FAILOVER = "no_failover";

    /** Context (Duration): per-attempt timeout, overriding the 160 s / 600 s defaults. */
    public static final String CTX_ATTEMPT_TIMEOUT = "attempt_timeout";

    /** Context (Duration): cap on the whole chain walk, for callers with a hard deadline. */
    public static final String CTX_TIME_BUDGET = "time_budget";

    /**
     * Context key a caller sets to bucket its usage under something other than
     * {@link RequestType#AGENT} — e.g. the Automations chatbot bills as CHATBOT so its
     * spend is separable from admin agent use in the AI usage screens. Value may be a
     * {@link RequestType} or its string value.
     */
    public static final String CTX_REQUEST_TYPE = "request_type";

    /**
     * Context flag (Boolean TRUE) asking for the usage row to be written SYNCHRONOUSLY so
     * its id lands on {@link LLMResponse#getUsageLogId()}. Callers that go on to charge
     * credits need that id: it is the {@code usage_log_id} on the deduction, which is what
     * links a credit_transactions row back to the tokens that produced it. Default (absent)
     * stays fire-and-forget, so the agent path is unchanged.
     */
    public static final String CTX_USAGE_LOG_SYNC = "usage_log_sync";

    /**
     * Context flag (Boolean TRUE): the caller charges this work itself some other way (a flat
     * per-operation fee), so billing.java_agent_charge must not add a token charge on top.
     * Callers that set {@link #CTX_USAGE_LOG_SYNC} bill themselves too and need not set it.
     */
    public static final String CTX_BILLED_BY_CALLER = "billed_by_caller";

    /** Context (Boolean TRUE): caller runs off-request (a background job) — 10 min read timeout. */
    public static final String CTX_LONG_RUNNING = "long_running";

    /**
     * Context (String low|medium|high): reasoning effort. Absent = "low" for GLM and none
     * for other models. Isoquant has no "medium"; it runs as "high" there.
     */
    public static final String CTX_REASONING_EFFORT = "reasoning_effort";

    /** Context (Boolean TRUE): ask for {@code response_format: json_object}. */
    public static final String CTX_JSON_MODE = "json_mode";

    /** Context (Number): overrides the default 0.7 temperature. */
    public static final String CTX_TEMPERATURE = "temperature";

    /**
     * Record the usage row for a completed call.
     *
     * <p>Token counts are already on the response (parsed in {@link #parseResponse}); this
     * only decides which bucket they land in and whether the write blocks.
     */
    private void logTokenUsage(LLMResponse llmResponse, ConversationSession session) {
        try {
            if (llmResponse.getPromptTokens() <= 0 && llmResponse.getCompletionTokens() <= 0) {
                return; // provider returned no usage block — nothing to record
            }

            // Parse each id independently: a caller with a non-UUID user id (an external
            // chat participant, say) must still get its institute-level usage recorded.
            UUID instituteId = toUuid(session.getInstituteId());
            UUID userId = toUuid(session.getUserId());

            Map<String, Object> ctx = session.getContext();
            RequestType requestType = resolveRequestType(ctx);

            if (ctx != null && Boolean.TRUE.equals(ctx.get(CTX_USAGE_LOG_SYNC))) {
                var saved = aiTokenUsageService.recordUsage(
                        ApiProvider.OPENAI,
                        requestType,
                        llmResponse.getModelUsed(),
                        llmResponse.getPromptTokens(),
                        llmResponse.getCompletionTokens(),
                        instituteId,
                        userId);
                if (saved != null && saved.getId() != null) {
                    llmResponse.setUsageLogId(saved.getId().toString());
                }
                return;
            }

            // Nobody bills this call. With billing.java_agent_charge on, price and charge it
            // (still off the request thread); off - the default - records it exactly as before.
            if (llmBilling != null
                    && !(ctx != null && Boolean.TRUE.equals(ctx.get(CTX_BILLED_BY_CALLER)))
                    && llmBilling.isEnabled()) {
                llmBilling.recordAndChargeAsync(
                        requestType,
                        llmResponse.getModelUsed(),
                        llmResponse.getPromptTokens(),
                        llmResponse.getCompletionTokens(),
                        instituteId,
                        userId,
                        // Usage-metering label only; the charge is the same for every use case.
                        ctx != null && ctx.get(CTX_USE_CASE) instanceof String u && !u.isBlank()
                                ? u : DEFAULT_USE_CASE);
                return;
            }

            aiTokenUsageService.recordUsageAsync(
                    ApiProvider.OPENAI,
                    requestType,
                    llmResponse.getModelUsed(),
                    llmResponse.getPromptTokens(),
                    llmResponse.getCompletionTokens(),
                    instituteId,
                    userId);
        } catch (Exception e) {
            // Never fail the main request due to usage logging issues
            log.warn("[LLMService] Failed to log token usage: {}", e.getMessage());
        }
    }

    /** {@link #CTX_REQUEST_TYPE} from the session context, defaulting to AGENT. */
    private static RequestType resolveRequestType(Map<String, Object> ctx) {
        Object configured = ctx == null ? null : ctx.get(CTX_REQUEST_TYPE);
        if (configured instanceof RequestType rt) return rt;
        if (configured instanceof String s && !s.isBlank()) {
            try {
                return RequestType.fromValue(s);
            } catch (IllegalArgumentException ignored) {
                // Unknown value — fall through to AGENT rather than losing the row to the
                // ai_token_usage request_type CHECK.
            }
        }
        return RequestType.AGENT;
    }

    private static UUID toUuid(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * Build the chat request with messages and tools. The model and reasoning effort are
     * set per attempt by {@link LlmGatewayRouter#callModel}.
     */
    private ObjectNode buildChatRequest(ConversationSession session) {
        ObjectNode request = objectMapper.createObjectNode();

        Map<String, Object> ctx = session.getContext();
        Object temperature = ctx == null ? null : ctx.get(CTX_TEMPERATURE);
        request.put("temperature", temperature instanceof Number n ? n.doubleValue() : 0.7);
        request.put("max_tokens", session.getMaxTokens() != null ? session.getMaxTokens() : 4096);
        if (ctx != null && Boolean.TRUE.equals(ctx.get(CTX_JSON_MODE))) {
            request.putObject("response_format").put("type", "json_object");
        }

        // Build messages array
        ArrayNode messages = objectMapper.createArrayNode();
        for (ConversationSession.ChatMessage msg : session.getHistory()) {
            messages.add(convertMessage(msg));
        }
        request.set("messages", messages);

        // Build tools array if we have pinned tools
        if (!session.getPinnedTools().isEmpty()) {
            ArrayNode tools = objectMapper.createArrayNode();
            for (ConversationSession.ToolDefinition tool : session.getPinnedTools()) {
                tools.add(convertTool(tool));
            }
            request.set("tools", tools);
            request.put("tool_choice", "auto");
        }

        return request;
    }

    /**
     * Convert internal message format to OpenAI format
     */
    private ObjectNode convertMessage(ConversationSession.ChatMessage msg) {
        ObjectNode message = objectMapper.createObjectNode();
        message.put("role", msg.getRole());

        if (msg.getContent() != null) {
            message.put("content", msg.getContent());
        }

        // Handle tool calls (assistant requesting tool use)
        if ("assistant".equals(msg.getRole()) && msg.getToolCallId() != null) {
            ArrayNode toolCalls = objectMapper.createArrayNode();
            ObjectNode toolCall = objectMapper.createObjectNode();
            toolCall.put("id", msg.getToolCallId());
            toolCall.put("type", "function");

            ObjectNode function = objectMapper.createObjectNode();
            function.put("name", msg.getToolName());
            try {
                function.put("arguments", objectMapper.writeValueAsString(msg.getToolArguments()));
            } catch (JsonProcessingException e) {
                function.put("arguments", "{}");
            }
            toolCall.set("function", function);
            toolCalls.add(toolCall);

            message.set("tool_calls", toolCalls);
            message.remove("content");
        }

        // Handle tool results
        if ("tool".equals(msg.getRole())) {
            message.put("tool_call_id", msg.getToolCallId());
            message.put("name", msg.getToolName());
        }

        return message;
    }

    /**
     * Convert tool definition to OpenAI function format
     */
    private ObjectNode convertTool(ConversationSession.ToolDefinition tool) {
        ObjectNode toolObj = objectMapper.createObjectNode();
        toolObj.put("type", "function");

        ObjectNode function = objectMapper.createObjectNode();
        function.put("name", tool.getName());
        function.put("description", tool.getDescription());

        // Build parameters schema
        ObjectNode parameters = objectMapper.createObjectNode();
        parameters.put("type", "object");

        ObjectNode properties = objectMapper.createObjectNode();
        ArrayNode required = objectMapper.createArrayNode();

        for (ConversationSession.ToolDefinition.ToolParameter param : tool.getParameters()) {
            ObjectNode paramObj = objectMapper.createObjectNode();
            paramObj.put("type", mapToJsonType(param.getType()));
            paramObj.put("description", param.getDescription());
            properties.set(param.getName(), paramObj);

            if (param.isRequired()) {
                required.add(param.getName());
            }
        }

        parameters.set("properties", properties);
        parameters.set("required", required);

        function.set("parameters", parameters);
        toolObj.set("function", function);

        return toolObj;
    }

    /**
     * Map Java types to JSON Schema types
     */
    private String mapToJsonType(String javaType) {
        if (javaType == null)
            return "string";
        String lower = javaType.toLowerCase();
        if (lower.contains("int") || lower.contains("long"))
            return "integer";
        if (lower.contains("double") || lower.contains("float"))
            return "number";
        if (lower.contains("bool"))
            return "boolean";
        if (lower.contains("list") || lower.contains("array"))
            return "array";
        if (lower.contains("map") || lower.contains("object"))
            return "object";
        return "string";
    }

    /**
     * Parse the LLM response
     */
    private LLMResponse parseResponse(String responseBody) throws JsonProcessingException {
        JsonNode root = objectMapper.readTree(responseBody);
        JsonNode choices = root.get("choices");

        if (choices == null || choices.isEmpty()) {
            throw new RuntimeException("No choices in LLM response");
        }

        JsonNode message = choices.get(0).get("message");
        String content = message.has("content") && !message.get("content").isNull()
                ? message.get("content").asText()
                : null;

        // Check for tool calls
        List<ToolCall> toolCalls = new ArrayList<>();
        if (message.has("tool_calls") && message.get("tool_calls").isArray()) {
            for (JsonNode tc : message.get("tool_calls")) {
                String id = tc.get("id").asText();
                JsonNode function = tc.get("function");
                String name = function.get("name").asText();
                String args = function.get("arguments").asText();

                Map<String, Object> arguments = objectMapper.readValue(
                        args,
                        new TypeReference<Map<String, Object>>() {
                        });

                toolCalls.add(new ToolCall(id, name, arguments));
            }
        }

        // Get finish reason
        String finishReason = choices.get(0).has("finish_reason")
                ? choices.get(0).get("finish_reason").asText()
                : "stop";

        // Real token counts — needed both for the usage row and for pricing the charge.
        JsonNode usage = root.get("usage");
        int promptTokens = usage != null && usage.has("prompt_tokens") ? usage.get("prompt_tokens").asInt() : 0;
        int completionTokens = usage != null && usage.has("completion_tokens")
                ? usage.get("completion_tokens").asInt() : 0;

        return LLMResponse.builder()
                .content(content)
                .toolCalls(toolCalls)
                .finishReason(finishReason)
                .hasToolCalls(!toolCalls.isEmpty())
                .promptTokens(promptTokens)
                .completionTokens(completionTokens)
                .build();
    }

    /**
     * LLM Response wrapper
     */
    @lombok.Data
    @lombok.Builder
    @lombok.NoArgsConstructor
    @lombok.AllArgsConstructor
    public static class LLMResponse {
        private String content;
        private List<ToolCall> toolCalls;
        private String finishReason;
        private boolean hasToolCalls;

        /**
         * Registry id of the model that answered (the chain may have failed over). Record and
         * charge usage under this, not the requested model.
         */
        private String modelUsed;

        /** Real usage from the provider's response — 0 when it returned no usage block. */
        private int promptTokens;
        private int completionTokens;

        /**
         * id of the ai_token_usage row this call wrote, set only when the caller asked
         * for a synchronous write via {@link LLMService#CTX_USAGE_LOG_SYNC}. Passed on as
         * {@code usage_log_id} so the credit transaction points back at the tokens.
         */
        private String usageLogId;
    }

    /**
     * Tool call from LLM
     */
    @lombok.Data
    @lombok.AllArgsConstructor
    public static class ToolCall {
        private String id;
        private String name;
        private Map<String, Object> arguments;
    }
}
