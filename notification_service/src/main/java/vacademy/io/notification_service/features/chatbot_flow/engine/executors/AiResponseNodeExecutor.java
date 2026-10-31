package vacademy.io.notification_service.features.chatbot_flow.engine.executors;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.NodeExecutionResult;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.enums.ChatbotNodeType;
import vacademy.io.notification_service.features.chatbot_flow.enums.EscalationReason;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowRepository;
import vacademy.io.notification_service.features.chatbot_flow.service.ChatbotEscalationService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppSendFailureService;

import java.util.*;
import java.util.regex.Pattern;

@Component
@Slf4j
@RequiredArgsConstructor
public class AiResponseNodeExecutor implements ChatbotNodeExecutor {

    /**
     * What the model emits when it cannot answer from the context it was given. Matched
     * case-insensitively and with optional single/double brackets, because models are inconsistent
     * about echoing a token exactly — and a missed marker means a hallucinated answer goes to a
     * real learner.
     */
    private static final Pattern ESCALATION_MARKER = Pattern.compile(
            "\\[{1,2}\\s*ESCALATE(?:_TO_HUMAN)?\\s*]{1,2}", Pattern.CASE_INSENSITIVE);

    private final ObjectMapper objectMapper;
    private final InternalClientUtils internalClientUtils;
    private final List<ChatbotMessageProvider> messageProviders;
    private final ChatbotEscalationService escalationService;
    private final WhatsAppSendFailureService sendFailureService;
    private final ChatbotFlowRepository flowRepository;

    @Value("${admin.core.service.baseurl:http://localhost:8081}")
    private String adminCoreServiceUrl;

    @Value("${spring.application.name:notification_service}")
    private String clientName;

    @Override
    public boolean canHandle(String nodeType) {
        return ChatbotNodeType.AI_RESPONSE.name().equals(nodeType);
    }

    @Override
    public NodeExecutionResult execute(ChatbotFlowNode node, ChatbotFlowSession session,
                                        String userText, FlowExecutionContext context) {
        Map<String, Object> config = parseConfig(node.getConfig());
        if (config == null) {
            return NodeExecutionResult.builder().success(false).errorMessage("Invalid AI config").build();
        }

        // Check exit keywords
        @SuppressWarnings("unchecked")
        List<String> exitKeywords = (List<String>) config.getOrDefault("exitKeywords", List.of());
        if (userText != null && !exitKeywords.isEmpty()) {
            String lower = userText.trim().toLowerCase();
            boolean isExit = exitKeywords.stream().anyMatch(k -> lower.contains(k.toLowerCase()));
            if (isExit) {
                log.info("AI exit keyword detected: {}", userText);
                return NodeExecutionResult.builder()
                        .success(true)
                        .waitForInput(false) // Exit AI mode, advance to next node
                        .build();
            }
        }

        // Check max turns
        int maxTurns = config.get("maxTurns") instanceof Number
                ? ((Number) config.get("maxTurns")).intValue() : 10;
        int currentTurns = getAiTurnCount(context.getSessionVariables());
        if (currentTurns >= maxTurns) {
            log.info("AI max turns reached: {}/{}", currentTurns, maxTurns);
            String fallbackMessage = resolveFallbackMessage(config,
                    "Let me connect you with a human agent.");
            sendTextToUser(context, fallbackMessage);
            // The learner is mid-question and the bot has stopped answering — that IS someone
            // waiting for a human, so flag it in the Inbox and tell the admins.
            raiseEscalation(node, session, context, config, EscalationReason.MAX_TURNS,
                    userText, fallbackMessage, null);
            return NodeExecutionResult.builder()
                    .success(true)
                    .waitForInput(false)
                    // Carry the message we actually sent so the Inbox thread shows it rather than
                    // the node's display name — an admin opening an escalation needs the real text.
                    .outputVariables(Map.of("ai_last_response", fallbackMessage))
                    .build();
        }

        // Enrich user text with button/list selection context
        if (userText != null && context.getButtonId() != null) {
            userText = userText + " [selected: " + context.getButtonId() + "]";
        } else if (userText != null && context.getListReplyId() != null) {
            userText = userText + " [selected: " + context.getListReplyId() + "]";
        }

        if (userText == null || userText.isBlank()) {
            // First time arriving at AI node with no text — use a default greeting
            // so the AI initiates the conversation instead of waiting silently
            userText = "Hello";
        }

        try {
            // Build conversation history from session context
            @SuppressWarnings("unchecked")
            List<Map<String, String>> history = context.getSessionVariables() != null
                    ? (List<Map<String, String>>) context.getSessionVariables().getOrDefault("ai_history", new ArrayList<>())
                    : new ArrayList<>();

            // Call admin-core-service AI endpoint
            // No model on the node = platform default: admin-core resolves the 'chatbot_flow'
            // row in ai_model_defaults (GLM by default). A model the author picked still wins.
            String modelId = config.get("modelId") instanceof String m && !m.isBlank() ? m.trim() : null;
            String userSystemPrompt = (String) config.getOrDefault("systemPrompt", "You are a helpful assistant.");
            // The visible-reply budget. admin-core adds reasoning headroom on top for models
            // that think before answering (GLM), so 500 stays a WhatsApp-sized reply.
            int maxTokens = config.get("maxTokens") instanceof Number
                    ? ((Number) config.get("maxTokens")).intValue() : 500;
            double temperature = config.get("temperature") instanceof Number
                    ? ((Number) config.get("temperature")).doubleValue() : 0.7;

            boolean enableInteractive = Boolean.TRUE.equals(config.get("enableInteractive"));
            // On by default: without it the model invents an answer whenever its context falls
            // short, which is strictly worse than saying "I'll check with the team".
            boolean escalationEnabled = !Boolean.FALSE.equals(config.get("escalateWhenUnsure"));

            // Inject WhatsApp context so the LLM knows its output goes directly as a message
            String whatsappContext = "\n\nIMPORTANT CONTEXT: Your response will be sent directly as a WhatsApp message to the user. "
                    + "Keep it concise and conversational. No explanations, no meta-commentary, no markdown headers. "
                    + "Do not say things like 'Here is my response' or 'This translates to'. "
                    + "Just reply naturally as if you are chatting on WhatsApp. "
                    + "Use WhatsApp formatting if needed: *bold*, _italic_. Keep responses under 300 characters when possible.";

            if (enableInteractive) {
                whatsappContext += "\n\nINTERACTIVE WHATSAPP ELEMENTS:\n"
                        + "When presenting clear choices to the user, you may include interactive UI elements. "
                        + "To do so, respond with a JSON object (and NOTHING else outside the JSON):\n\n"
                        + "For reply buttons (2-3 discrete choices):\n"
                        + "{\"text\":\"Your message here\",\"interactive\":{\"type\":\"button\",\"buttons\":[{\"id\":\"btn_id\",\"title\":\"Label (max 20 chars)\"}]}}\n\n"
                        + "For list menus (4+ options, optionally grouped):\n"
                        + "{\"text\":\"Your message here\",\"interactive\":{\"type\":\"list\",\"buttonText\":\"Menu Label\",\"sections\":[{\"title\":\"Section\",\"rows\":[{\"id\":\"row_id\",\"title\":\"Max 24 chars\",\"description\":\"Optional detail\"}]}]}}\n\n"
                        + "Rules:\n"
                        + "- Max 3 buttons, each title max 20 characters.\n"
                        + "- Max 10 list rows total, each title max 24 characters.\n"
                        + "- The \"text\" field must be a complete, meaningful standalone message.\n"
                        + "- Only use interactive elements when presenting clear choices. For conversational replies, just respond with plain text (NO JSON wrapping).\n"
                        + "- Button/row IDs should be short, descriptive, lowercase with underscores.\n"
                        + "- NEVER wrap plain text responses in JSON.\n"
                        + "- When using interactive JSON, your ENTIRE response must be ONLY the JSON object — no text before or after it. Do NOT add ```json, markdown fences, or any prefix/suffix. The \"text\" field inside the JSON is your message.\n";
            }

            if (escalationEnabled) {
                whatsappContext += "\n\nWHEN YOU DO NOT KNOW:\n"
                        + "You may ONLY answer from the information given to you above. If the answer "
                        + "is not in that information — the question is about this specific person's "
                        + "records, fees, dates, results, or anything else you were not told — do NOT "
                        + "guess, do NOT invent details, and do NOT give a generic non-answer.\n"
                        + "Instead reply with EXACTLY this token and nothing else:\n"
                        + "[[ESCALATE]]\n"
                        + "A human from the team will then take over and reply. Use the token only "
                        + "when you genuinely lack the information — questions you CAN answer from "
                        + "the information above must be answered normally.\n";
            }

            String systemPrompt = userSystemPrompt + whatsappContext;

            Map<String, Object> aiRequest = new LinkedHashMap<>();
            aiRequest.put("instituteId", context.getInstituteId());
            if (modelId != null) {
                aiRequest.put("modelId", modelId);
            }
            aiRequest.put("systemPrompt", systemPrompt);
            aiRequest.put("conversationHistory", history);
            aiRequest.put("userMessage", userText);
            aiRequest.put("maxTokens", maxTokens);
            aiRequest.put("temperature", temperature);
            // Billing attribution — admin-core charges this turn's tokens to the institute
            // but books them against the learner and the flow, so the spend is legible in
            // the AI usage history instead of landing as an anonymous system charge.
            if (context.getUserId() != null) {
                aiRequest.put("userId", context.getUserId());
            }
            if (session != null) {
                aiRequest.put("sessionId", session.getId());
                aiRequest.put("flowId", session.getFlowId());
                String flowName = resolveFlowName(session.getFlowId());
                if (flowName != null) {
                    aiRequest.put("flowName", flowName);
                }
            }

            String endpoint = "/admin-core-service/internal/chatbot-ai/respond";

            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.POST.name(), adminCoreServiceUrl, endpoint, aiRequest);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                @SuppressWarnings("unchecked")
                Map<String, Object> responseBody = objectMapper.readValue(response.getBody(), Map.class);

                // Out of AI credits: no model was called and there is no answer to send.
                // Say so honestly, hand the learner to a human, and stop the AI loop —
                // retrying every turn would only re-pay the balance check and keep the
                // learner talking to a bot that cannot reply.
                if (Boolean.TRUE.equals(responseBody.get("insufficientCredits"))) {
                    // admin_core sets usageLimited when the pause is an AI usage limit (a cap
                    // the institute set), not an empty wallet: same pause, but the Inbox note
                    // must not tell admins to top up. Absent (older admin_core) = credits.
                    boolean usageLimited = Boolean.TRUE.equals(responseBody.get("usageLimited"));
                    String note = usageLimited ? usageLimitNote(responseBody.get("usageLimitMessage"))
                            : "Institute has no AI credits";
                    log.warn("Chatbot AI paused for institute {} — {}", context.getInstituteId(),
                            usageLimited ? "AI usage limit reached" : "no AI credits");
                    String outOfCreditsMessage = resolveEscalationMessage(config);
                    sendTextToUser(context, outOfCreditsMessage);
                    raiseEscalation(node, session, context, config, EscalationReason.NO_CREDITS,
                            userText, outOfCreditsMessage, note);
                    return NodeExecutionResult.builder()
                            .success(true)
                            .waitForInput(false)
                            .outputVariables(Map.of("ai_last_response", outOfCreditsMessage))
                            .build();
                }

                String assistantMessage = (String) responseBody.get("assistantMessage");

                // "I don't have that context" → say so honestly, hand over to a human, and make
                // the wait visible in the Inbox instead of letting the model improvise.
                boolean escalating = escalationEnabled && hasEscalationMarker(assistantMessage);

                String displayText;
                if (escalating) {
                    displayText = resolveEscalationMessage(config);
                    sendTextToUser(context, displayText);
                    raiseEscalation(node, session, context, config, EscalationReason.NO_CONTEXT,
                            userText, displayText, null);
                } else {
                    // Send AI reply — parse for interactive elements if enabled
                    displayText = assistantMessage;
                    if (assistantMessage != null && !assistantMessage.isBlank()) {
                        displayText = parseAndSendAiResponse(context, assistantMessage, enableInteractive);
                    }
                }

                // Update conversation history — store clean text, not raw JSON
                List<Map<String, String>> updatedHistory = new ArrayList<>(history);
                updatedHistory.add(Map.of("role", "user", "content", userText));
                if (displayText != null) {
                    updatedHistory.add(Map.of("role", "assistant", "content", displayText));
                }

                Map<String, Object> outputVars = new HashMap<>();
                outputVars.put("ai_history", updatedHistory);
                outputVars.put("ai_turns", currentTurns + 1);
                outputVars.put("ai_last_response", displayText);
                outputVars.put("ai_escalated", escalating);

                return NodeExecutionResult.builder()
                        .success(true)
                        // Stay in AI conversation mode even after escalating: the learner may well
                        // ask something the bot CAN answer next, and the human reply arrives
                        // independently through the Inbox.
                        .waitForInput(true)
                        .outputVariables(outputVars)
                        .build();
            }

            return NodeExecutionResult.builder()
                    .success(false)
                    .errorMessage("AI service returned non-success")
                    .build();

        } catch (Exception e) {
            log.error("AI response failed: {}", e.getMessage(), e);
            String fallbackMessage = resolveFallbackMessage(config,
                    "I'm having trouble understanding. Let me connect you with a human agent.");
            sendTextToUser(context, fallbackMessage);
            // The learner asked something and got a non-answer — that is a human hand-over too.
            raiseEscalation(node, session, context, config, EscalationReason.AI_ERROR,
                    userText, fallbackMessage, e.getMessage());
            return NodeExecutionResult.builder()
                    .success(true)
                    .waitForInput(false) // Exit AI mode on error
                    .outputVariables(Map.of("ai_last_response", fallbackMessage))
                    .build();
        }
    }

    /**
     * The configured fallback text, or {@code defaultMessage}.
     *
     * <p>Not {@code getOrDefault}: that returns null when the key is PRESENT with a JSON null, and
     * these values flow into {@code Map.of(...)} output variables, which rejects nulls with an NPE
     * — from a path whose whole job is to keep a failing turn from breaking the flow.
     */
    private String resolveFallbackMessage(Map<String, Object> config, String defaultMessage) {
        Object configured = config.get("fallbackMessage");
        return (configured instanceof String s && !s.isBlank()) ? s : defaultMessage;
    }

    /** True when the model signalled that the answer is not in the context it was given. */
    private boolean hasEscalationMarker(String assistantMessage) {
        return assistantMessage != null && ESCALATION_MARKER.matcher(assistantMessage).find();
    }

    /** What we actually say to the learner when handing over. */
    private String resolveEscalationMessage(Map<String, Object> config) {
        Object configured = config.get("escalationMessage");
        if (configured instanceof String s && !s.isBlank()) return s.trim();
        return ChatbotEscalationService.DEFAULT_ESCALATION_MESSAGE;
    }

    /**
     * Flag the conversation as waiting for a human (Inbox "Unanswered") and email the flow's
     * configured admin addresses. Never throws — a hand-over that fails to record must not also
     * break the reply the learner already received.
     */
    /** Inbox note for a usage-limit pause (the limit's own sentence when admin_core sent one). */
    static String usageLimitNote(Object limitMessage) {
        String m = limitMessage == null ? "" : limitMessage.toString().trim();
        return m.isEmpty() ? "AI usage limit reached (not a credits problem; it resets on its own)"
                : "AI usage limit reached: " + m;
    }

    private void raiseEscalation(ChatbotFlowNode node, ChatbotFlowSession session,
                                 FlowExecutionContext context, Map<String, Object> config,
                                 EscalationReason reason, String userText, String botReply,
                                 String error) {
        if (Boolean.FALSE.equals(config.get("escalationNotify"))) {
            // Explicit opt-out on this node: still no escalation record, per the author's choice.
            return;
        }
        try {
            escalationService.raise(ChatbotEscalationService.EscalationRequest.builder()
                    .instituteId(context.getInstituteId())
                    .flowId(session != null ? session.getFlowId() : null)
                    .sessionId(session != null ? session.getId() : null)
                    .nodeId(node != null ? node.getId() : null)
                    .userPhone(context.getPhoneNumber())
                    .userId(context.getUserId())
                    .userName(resolveUserName(context))
                    .channelType(context.getChannelType())
                    .businessChannelId(context.getBusinessChannelId())
                    .reason(reason)
                    .userMessage(userText)
                    .botReply(botReply)
                    .errorMessage(error)
                    .build());
        } catch (Exception e) {
            log.warn("Failed to raise escalation for phone={}: {}",
                    context.getPhoneNumber(), e.getMessage());
        }
    }

    /**
     * Flow name for the credit transaction's description, so the AI usage history reads
     * "Chatbot AI reply — Admissions bot" rather than a bare uuid. Best effort: a PK
     * lookup that fails just means the description falls back to the flow id.
     */
    private String resolveFlowName(String flowId) {
        if (flowId == null) return null;
        try {
            return flowRepository.findById(flowId).map(f -> f.getName()).orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private String resolveUserName(FlowExecutionContext context) {
        Map<String, Object> details = context.getUserDetails();
        if (details == null) return null;
        Object user = details.get("user");
        if (!(user instanceof Map)) return null;
        Map<String, Object> userMap = (Map<String, Object>) user;
        Object name = userMap.get("full_name");
        if (name == null) name = userMap.get("fullName");
        return name != null ? name.toString() : null;
    }

    private int getAiTurnCount(Map<String, Object> sessionVars) {
        if (sessionVars == null) return 0;
        Object turns = sessionVars.get("ai_turns");
        return turns instanceof Number ? ((Number) turns).intValue() : 0;
    }

    /**
     * Parse AI response for interactive elements. Returns the display text
     * (plain text portion) for history storage.
     */
    @SuppressWarnings("unchecked")
    private String parseAndSendAiResponse(FlowExecutionContext ctx, String msg, boolean interactive) {
        if (!interactive || msg == null) {
            sendTextToUser(ctx, msg);
            return msg;
        }

        // Try to extract JSON from the response — LLMs may add text before/after JSON,
        // markdown fences, or "json" prefix
        String jsonStr = extractJsonObject(msg);
        if (jsonStr == null) {
            sendTextToUser(ctx, msg);
            return msg;
        }

        try {
            Map<String, Object> parsed = objectMapper.readValue(jsonStr, new TypeReference<>() {});
            String text = (String) parsed.get("text");
            Map<String, Object> interactiveData = (Map<String, Object>) parsed.get("interactive");

            // If JSON has no "text" but has "interactive", use text before the JSON as body
            if ((text == null || text.isBlank()) && interactiveData != null) {
                int jsonStart = msg.indexOf(jsonStr);
                if (jsonStart > 0) {
                    text = msg.substring(0, jsonStart).trim();
                }
            }

            if (text == null || text.isBlank()) {
                sendTextToUser(ctx, msg);
                return msg;
            }
            if (interactiveData == null) {
                sendTextToUser(ctx, text);
                return text;
            }

            // Build payload matching ChatbotMessageProvider.sendInteractive() format
            String type = (String) interactiveData.getOrDefault("type", "button");
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("interactiveType", type);
            payload.put("body", text);

            if ("button".equals(type)) {
                List<Map<String, Object>> buttons = (List<Map<String, Object>>) interactiveData.get("buttons");
                payload.put("buttons", sanitizeButtons(buttons));
            } else if ("list".equals(type)) {
                payload.put("listButtonText", interactiveData.getOrDefault("buttonText", "Select"));
                payload.put("sections", sanitizeSections(
                        (List<Map<String, Object>>) interactiveData.get("sections")));
            }

            sendInteractiveToUser(ctx, payload, text);
            return text;

        } catch (Exception e) {
            log.warn("AI interactive parse failed, falling back to text: {}", e.getMessage());
            sendTextToUser(ctx, msg);
            return msg;
        }
    }

    /**
     * Extract a JSON object from an AI response that may contain extra text.
     * Handles: pure JSON, markdown fences, "json" prefix, or text + JSON mixed.
     * Returns null if no valid JSON object with interactive elements is found.
     */
    private String extractJsonObject(String msg) {
        if (msg == null) return null;
        String trimmed = msg.trim();

        // Strip markdown code fences
        if (trimmed.startsWith("```json")) trimmed = trimmed.substring(7);
        else if (trimmed.startsWith("```")) trimmed = trimmed.substring(3);
        if (trimmed.endsWith("```")) trimmed = trimmed.substring(0, trimmed.length() - 3);
        trimmed = trimmed.trim();
        if (trimmed.startsWith("json")) trimmed = trimmed.substring(4).trim();

        // If it starts with { now, use it directly
        if (trimmed.startsWith("{")) return trimmed;

        // LLM may have mixed text + JSON — find the first { that starts a JSON block
        int firstBrace = msg.indexOf('{');
        if (firstBrace < 0) return null;
        String candidate = msg.substring(firstBrace);
        // Must contain "interactive" to be our format (may or may not have "text")
        if (candidate.contains("\"interactive\"")) {
            return candidate;
        }
        return null;
    }

    private List<Map<String, Object>> sanitizeButtons(List<Map<String, Object>> buttons) {
        if (buttons == null || buttons.isEmpty()) return List.of();
        List<Map<String, Object>> result = new ArrayList<>();
        for (int i = 0; i < Math.min(buttons.size(), 3); i++) {
            Map<String, Object> btn = new LinkedHashMap<>(buttons.get(i));
            String title = btn.getOrDefault("title", "").toString();
            if (title.length() > 20) btn.put("title", title.substring(0, 20));
            String id = btn.getOrDefault("id", "btn_" + i).toString();
            if (id.isBlank()) id = "btn_" + i;
            btn.put("id", id);
            result.add(btn);
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> sanitizeSections(List<Map<String, Object>> sections) {
        if (sections == null || sections.isEmpty()) return List.of();
        List<Map<String, Object>> result = new ArrayList<>();
        int totalRows = 0;
        for (Map<String, Object> section : sections) {
            Map<String, Object> sanitized = new LinkedHashMap<>(section);
            List<Map<String, Object>> rows = (List<Map<String, Object>>) section.getOrDefault("rows", List.of());
            List<Map<String, Object>> sanitizedRows = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                if (totalRows >= 10) break;
                Map<String, Object> r = new LinkedHashMap<>(row);
                String title = r.getOrDefault("title", "").toString();
                if (title.length() > 24) r.put("title", title.substring(0, 24));
                String desc = r.getOrDefault("description", "").toString();
                if (desc.length() > 72) r.put("description", desc.substring(0, 72));
                String id = r.getOrDefault("id", "row_" + totalRows).toString();
                if (id.isBlank()) r.put("id", "row_" + totalRows);
                sanitizedRows.add(r);
                totalRows++;
            }
            sanitized.put("rows", sanitizedRows);
            result.add(sanitized);
        }
        return result;
    }

    private void sendInteractiveToUser(FlowExecutionContext ctx, Map<String, Object> payload, String fallbackText) {
        ChatbotMessageProvider provider = messageProviders.stream()
                .filter(p -> p.supports(ctx.getChannelType()))
                .findFirst().orElse(null);
        if (provider == null) {
            logSendFailure(ctx, "interactive", fallbackText,
                    "No provider for channel: " + ctx.getChannelType());
            return;
        }
        try {
            ctx.setLastProviderMessageId(
                    provider.sendInteractive(ctx.getPhoneNumber(), payload,
                            ctx.getInstituteId(), ctx.getBusinessChannelId()));
        } catch (Exception e) {
            log.warn("sendInteractive failed, falling back to text: {}", e.getMessage());
            try {
                ctx.setLastProviderMessageId(
                        provider.sendText(ctx.getPhoneNumber(), fallbackText,
                                ctx.getInstituteId(), ctx.getBusinessChannelId()));
            } catch (Exception textEx) {
                // Both shapes refused — the learner got nothing, so say so in the Inbox.
                logSendFailure(ctx, "interactive", fallbackText, textEx.getMessage());
            }
        }
    }

    private void sendTextToUser(FlowExecutionContext context, String text) {
        ChatbotMessageProvider provider = messageProviders.stream()
                .filter(p -> p.supports(context.getChannelType()))
                .findFirst().orElse(null);
        if (provider == null) {
            logSendFailure(context, "text", text,
                    "No provider for channel: " + context.getChannelType());
            return;
        }
        try {
            // The id the engine stamps on the outgoing row, so this reply's ticks can advance.
            context.setLastProviderMessageId(
                    provider.sendText(context.getPhoneNumber(), text,
                            context.getInstituteId(), context.getBusinessChannelId()));
        } catch (Exception e) {
            // Swallow: the AI turn itself succeeded, and the caller's own error path would send a
            // second (equally undeliverable) message. The failure is recorded for the Inbox.
            log.error("Failed to send AI reply to {}: {}", context.getPhoneNumber(), e.getMessage());
            logSendFailure(context, "text", text, e.getMessage());
        }
    }

    private void logSendFailure(FlowExecutionContext ctx, String type, String body, String error) {
        sendFailureService.logFailure(ctx.getInstituteId(), ctx.getPhoneNumber(),
                ctx.getBusinessChannelId(), ctx.getUserId(), type, body, "CHATBOT_FLOW", error);
        // Tell the engine this message is already on file as failed, so it doesn't log a second,
        // delivered-looking row for the same attempt.
        ctx.setSendFailureLogged(true);
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
