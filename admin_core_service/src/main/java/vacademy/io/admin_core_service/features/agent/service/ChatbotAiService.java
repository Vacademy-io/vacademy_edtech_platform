package vacademy.io.admin_core_service.features.agent.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.agent.dto.ChatbotAiRequest;
import vacademy.io.admin_core_service.features.agent.dto.ChatbotAiResponse;
import vacademy.io.admin_core_service.features.agent.dto.ConversationSession;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.credits.client.AuthorizeResult;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/**
 * One AI turn of an Automations chatbot flow (notification_service's AI_RESPONSE node).
 *
 * <p>Metered like every other AI surface on the platform:
 * <ol>
 *   <li>pre-flight affordability, failing CLOSED — an institute with no credits gets no
 *       model call at all, and the flow hands the learner to a human instead;</li>
 *   <li>the turn's real token counts are written to ai_token_usage as {@code chatbot};</li>
 *   <li>credits are charged against that usage row, attributed to the learner the bot is
 *       talking to and batched by flow id, so it shows up in the AI usage history
 *       alongside every other AI activity.</li>
 * </ol>
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class ChatbotAiService {

    /** ai_model_defaults row that picks the model when the flow node names none. */
    static final String USE_CASE = "chatbot_flow";

    /**
     * notification_service gives this call 30 s (InternalClientUtils read timeout). The
     * chain walk must finish inside that, failover included, or the learner gets nothing.
     */
    private static final Duration ATTEMPT_TIMEOUT = Duration.ofSeconds(20);
    private static final Duration TIME_BUDGET = Duration.ofSeconds(27);

    /**
     * Attribution role on the credit transaction. The bot is answering a learner/lead over
     * WhatsApp, not an admin operating the dashboard, so the spend is rolled up under the
     * learner in the per-user usage screens.
     */
    private static final String CREDIT_USER_ROLE = "LEARNER";

    private final LLMService llmService;
    private final CreditClient creditClient;

    public ChatbotAiResponse respond(ChatbotAiRequest request) {
        log.info("Chatbot AI request: institute={}, model={}", request.getInstituteId(), request.getModelId());

        if (request.getUserMessage() == null || request.getUserMessage().isBlank()) {
            return ChatbotAiResponse.builder()
                    .assistantMessage("No message provided.")
                    .exitIntent(false)
                    .build();
        }

        // 1. Affordability, fail CLOSED. hasActiveCredits already returns false when the
        // balance cannot be read, so an unreachable credits service pauses the bot rather
        // than letting it keep spending at the provider un-metered. Same posture as the
        // Engagement Engine's autonomous sends and AI calling. An empty wallet is then asked
        // once more about the institute's LIVE AI plan (chatbot replies can be included in a
        // plan); no LIVE plan = no extra call, and any failure there = today's answer.
        if (!hasCredits(request)) {
            log.warn("Chatbot AI turn refused — institute {} has no AI credits", request.getInstituteId());
            return ChatbotAiResponse.builder()
                    .insufficientCredits(true)
                    .exitIntent(false)
                    .build();
        }

        // 1b. AI usage limits (institute policy in ENFORCE). A refusal takes the same pause
        // path as an empty wallet: the flow hands the learner to a human. No limits on for
        // the institute = no call at all; any gate failure = allowed.
        AuthorizeResult limit = usageLimitDecision(request);
        if (AuthorizeResult.blocks(limit)) {
            log.warn("Chatbot AI turn refused — institute {} reached an AI usage limit", request.getInstituteId());
            return ChatbotAiResponse.builder()
                    .insufficientCredits(true)
                    .usageLimited(true)
                    .usageLimitMessage(limit.message())
                    .exitIntent(false)
                    .build();
        }

        // A model saved on the flow node is the author's pick and wins; otherwise the
        // chatbot_flow row decides (GLM by default), with its fallback behind it.
        String model = request.getModelId() != null && !request.getModelId().isBlank()
                ? request.getModelId().trim() : null;

        // Build a ConversationSession from the request
        ConversationSession session = ConversationSession.create(
                request.getSessionId() != null ? request.getSessionId() : UUID.randomUUID().toString(),
                request.getUserId(),
                request.getInstituteId(),
                model,
                null
        );

        // Bucket this call as CHATBOT (not AGENT) and write the usage row synchronously so
        // its id can link the credit transaction back to the tokens that caused it.
        session.getContext().put(LLMService.CTX_REQUEST_TYPE, RequestType.CHATBOT);
        session.getContext().put(LLMService.CTX_USAGE_LOG_SYNC, Boolean.TRUE);
        session.getContext().put(LLMService.CTX_USE_CASE, USE_CASE);
        session.getContext().put(LLMService.CTX_ATTEMPT_TIMEOUT, ATTEMPT_TIMEOUT);
        session.getContext().put(LLMService.CTX_TIME_BUDGET, TIME_BUDGET);

        // Add system prompt
        session.addMessage(ConversationSession.ChatMessage.system(
                request.getSystemPrompt() != null ? request.getSystemPrompt() : "You are a helpful assistant."));

        // Add conversation history
        if (request.getConversationHistory() != null) {
            for (Map<String, String> msg : request.getConversationHistory()) {
                String role = msg.get("role");
                String content = msg.get("content");
                if ("user".equals(role)) {
                    session.addMessage(ConversationSession.ChatMessage.user(content));
                } else if ("assistant".equals(role)) {
                    session.addMessage(ConversationSession.ChatMessage.assistant(content));
                }
            }
        }

        // Add current user message
        session.addMessage(ConversationSession.ChatMessage.user(request.getUserMessage()));

        // Set max tokens and temperature in context
        int maxTokens = request.getMaxTokens() > 0 ? request.getMaxTokens() : 500;
        session.getContext().put("max_tokens", maxTokens);
        session.getContext().put("temperature", request.getTemperature() > 0 ? request.getTemperature() : 0.7);
        // buildChatRequest reads the field, not the context entry — without this the node's
        // configured ceiling was ignored and every turn ran at the 4096 default. That is
        // billable output now, so the author's budget has to actually reach the provider.
        session.setMaxTokens(maxTokens);

        try {
            LLMService.LLMResponse response = llmService.generateChatCompletion(session);

            // 2. Charge for the tokens actually burned. Fire-and-forget: the reply is
            // already generated and must not wait on (or be lost to) the billing hop.
            // Under the registry id that answered: the chain may have failed over.
            charge(request, response.getModelUsed(), response);

            log.info("Chatbot AI response generated successfully ({} prompt / {} completion tokens)",
                    response.getPromptTokens(), response.getCompletionTokens());

            return ChatbotAiResponse.builder()
                    .assistantMessage(response.getContent())
                    .promptTokens(response.getPromptTokens())
                    .completionTokens(response.getCompletionTokens())
                    .exitIntent(false)
                    .build();

        } catch (Exception e) {
            log.error("Chatbot AI generation failed: {}", e.getMessage(), e);
            return ChatbotAiResponse.builder()
                    .assistantMessage("I'm sorry, I'm having trouble right now. Please try again later.")
                    .promptTokens(0)
                    .completionTokens(0)
                    .exitIntent(false)
                    .build();
        }
    }

    /**
     * Balance gate, then the plan. Never throws — an error here is "cannot confirm funds",
     * i.e. no. The wallet is read first and unchanged; only a "no" from it asks whether the
     * institute's LIVE AI plan covers this reply ({@link CreditClient#planCovers}).
     */
    private boolean hasCredits(ChatbotAiRequest request) {
        String instituteId = request.getInstituteId();
        try {
            if (creditClient.hasActiveCredits(instituteId)) {
                return true;
            }
            String model = request.getModelId() != null && !request.getModelId().isBlank()
                    ? request.getModelId().trim() : null;
            return creditClient.planCovers(instituteId, RequestType.CHATBOT.getValue(), model,
                    estimateTokens(request), request.getUserId(), chargeMetering(request));
        } catch (Exception e) {
            log.warn("Credit check failed for institute {} — pausing chatbot AI: {}",
                    instituteId, e.getMessage());
            return false;
        }
    }

    /** Limit gate. Never throws; an error here is "allowed" (limits fail open). */
    private AuthorizeResult usageLimitDecision(ChatbotAiRequest request) {
        try {
            return creditClient.authorize(request.getInstituteId(), USE_CASE,
                    RequestType.CHATBOT.getValue(), chargeMetering(request), request.getUserId());
        } catch (Exception e) {
            return AuthorizeResult.ALLOW_NONE;
        }
    }

    /**
     * Charge one chatbot turn. Nothing here may throw: the learner already has the reply,
     * so a billing hiccup must not turn a delivered answer into an error path.
     */
    private void charge(ChatbotAiRequest request, String model, LLMService.LLMResponse response) {
        if (response.getPromptTokens() <= 0 && response.getCompletionTokens() <= 0) {
            // Provider returned no usage block — nothing to price, and a zero-token charge
            // would still bill the request_type's minimum. Skip rather than over-charge.
            return;
        }
        try {
            creditClient.deductAttributedTokenUsageAsync(
                    request.getInstituteId(),
                    RequestType.CHATBOT.getValue(),
                    model,
                    response.getPromptTokens(),
                    response.getCompletionTokens(),
                    response.getUsageLogId(),
                    request.getUserId(),
                    request.getUserId() != null ? CREDIT_USER_ROLE : "SYSTEM",
                    // Actor and subject are the same person here; sending it explicitly keeps
                    // the COALESCE(subject_user_id, user_id) attribution stable if the actor
                    // ever becomes the bot rather than the learner.
                    request.getUserId(),
                    describe(request),
                    request.getFlowId(),
                    chargeMetering(request));
        } catch (Exception e) {
            log.error("Chatbot credit charge failed for institute {} (flow {}): {}",
                    request.getInstituteId(), request.getFlowId(), e.getMessage());
        }
    }

    /**
     * Usage-metering fields for one chatbot turn: the person chatting (a LEARNER, as on the
     * ledger row) or a public visitor, on WhatsApp, with the flow in the context.
     */
    static MeteringFields chargeMetering(ChatbotAiRequest request) {
        Map<String, Object> context = new java.util.HashMap<>();
        if (request.getFlowId() != null) context.put("flow_id", request.getFlowId());
        if (request.getFlowName() != null) context.put("flow_name", request.getFlowName());
        if (request.getSessionId() != null) context.put("session_id", request.getSessionId());
        MeteringFields.MeteringFieldsBuilder b = MeteringFields.builder()
                .useCase(USE_CASE)
                .surface(MeteringFields.SURFACE_WHATSAPP)
                .sourceService(MeteringFields.SOURCE_ADMIN_CORE)
                .usageContext(context);
        if (request.getUserId() != null) {
            b.actorKind(MeteringFields.ACTOR_USER).actorRoleClass(CREDIT_USER_ROLE);
        } else {
            b.actorKind("PUBLIC").actorRoleClass("PUBLIC");
        }
        return b.build();
    }

    /** Rough prompt + reply token estimate for the plan pre-check (about 4 characters a token). */
    static int estimateTokens(ChatbotAiRequest request) {
        long chars = length(request.getSystemPrompt()) + length(request.getUserMessage());
        if (request.getConversationHistory() != null) {
            for (Map<String, String> msg : request.getConversationHistory()) {
                if (msg != null) chars += length(msg.get("content"));
            }
        }
        int reply = request.getMaxTokens() > 0 ? request.getMaxTokens() : 500;
        return (int) Math.min(Integer.MAX_VALUE, chars / 4 + reply);
    }

    private static long length(String s) {
        return s == null ? 0 : s.length();
    }

    private static String describe(ChatbotAiRequest request) {
        String flow = (request.getFlowName() != null && !request.getFlowName().isBlank())
                ? request.getFlowName()
                : request.getFlowId();
        return flow != null ? "Chatbot AI reply — " + flow : "Chatbot AI reply";
    }
}
