package vacademy.io.admin_core_service.features.agent.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import vacademy.io.admin_core_service.features.agent.dto.*;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.credits.client.AuthorizeResult;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Core Agent Orchestrator implementing the ReAct loop.
 * Coordinates between LLM, tools, and user interactions.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentOrchestrator {

    private static final int MAX_LOOPS = 10;
    private static final int SSE_SUBSCRIPTION_DELAY_MS = 500; // Allow time for SSE subscription

    private final LLMService llmService;
    private final VectorSearchService vectorSearchService;
    private final ToolExecutor toolExecutor;
    private final ConversationManager conversationManager;
    private final CreditClient creditClient;

    // SSE emitters for each session
    private final Map<String, SseEmitter> emitters = new ConcurrentHashMap<>();

    // Pending tool calls awaiting confirmation
    private final Map<String, PendingToolCall> pendingToolCalls = new ConcurrentHashMap<>();

    // Executor for async processing
    private final ExecutorService executor = Executors.newCachedThreadPool();

    /**
     * Start a new chat session
     */
    public AgentChatResponse startChat(AgentChatRequest request, String userId, String userToken) {
        log.info("[AgentOrchestrator] Starting chat for user: {}", userId);

        // Create or get session
        ConversationSession session;
        if (request.getSessionId() != null) {
            session = conversationManager.getSession(request.getSessionId());
            if (session == null) {
                return AgentChatResponse.error("Session not found or expired");
            }
            if (session.isExpired()) {
                return AgentChatResponse.error("Session expired");
            }
            conversationManager.resumeSession(session);
        } else {
            // A model picked in the UI wins; null lets the admin_agent row decide (GLM by default).
            session = conversationManager.createSession(
                    userId,
                    request.getInstituteId(),
                    request.getModel() == null || request.getModel().isBlank() ? null : request.getModel().trim(),
                    userToken);
            session.getContext().put(LLMService.CTX_USE_CASE, LLMService.DEFAULT_USE_CASE);
        }

        // Add context if provided
        if (request.getContext() != null) {
            if (request.getContext().getPackageSessionId() != null) {
                session.getContext().put("packageSessionId", request.getContext().getPackageSessionId());
            }
            if (request.getContext().getCourseId() != null) {
                session.getContext().put("courseId", request.getContext().getCourseId());
            }
        }

        // Add user message
        conversationManager.addUserMessage(session, request.getMessage());

        // Search for relevant tools if not already pinned
        if (session.getPinnedTools().isEmpty()) {
            List<ConversationSession.ToolDefinition> tools = vectorSearchService
                    .searchRelevantTools(request.getMessage());
            conversationManager.pinTools(session, tools);
            log.info("[AgentOrchestrator] Pinned {} tools for session: {}",
                    tools.size(), session.getSessionId());
        }

        // Start async processing
        executor.submit(() -> processAgentLoop(session));

        return AgentChatResponse.started(session.getSessionId());
    }

    /**
     * Handle user response to confirmation
     */
    public AgentChatResponse respondToAgent(String sessionId, AgentRespondRequest request) {
        log.info("[AgentOrchestrator] User responding to session: {}", sessionId);

        ConversationSession session = conversationManager.getSession(sessionId);
        if (session == null) {
            return AgentChatResponse.error("Session not found");
        }

        if (!session.isAwaitingInput()) {
            return AgentChatResponse.error("Session is not waiting for input");
        }

        // Resume session
        conversationManager.resumeSession(session);
        conversationManager.addUserMessage(session, request.getResponse());

        // Continue processing
        executor.submit(() -> processAgentLoop(session));

        return AgentChatResponse.resumed(sessionId);
    }

    /**
     * Subscribe to SSE stream for a session
     */
    public SseEmitter subscribeToStream(String sessionId) {
        log.info("[AgentOrchestrator] Client subscribing to session: {}", sessionId);

        SseEmitter emitter = new SseEmitter(5 * 60 * 1000L); // 5 minutes timeout

        emitter.onCompletion(() -> {
            log.info("[AgentOrchestrator] SSE completed for session: {}", sessionId);
            emitters.remove(sessionId);
        });

        emitter.onTimeout(() -> {
            log.info("[AgentOrchestrator] SSE timeout for session: {}", sessionId);
            emitters.remove(sessionId);
        });

        emitter.onError(e -> {
            log.error("[AgentOrchestrator] SSE error for session: {}: {}", sessionId, e.getMessage());
            emitters.remove(sessionId);
        });

        emitters.put(sessionId, emitter);

        return emitter;
    }

    /**
     * The core ReAct loop
     */
    private void processAgentLoop(ConversationSession session) {
        String sessionId = session.getSessionId();
        log.info("[AgentOrchestrator] Starting agent loop for session: {}", sessionId);

        // Add a small delay to allow SSE subscription
        try {
            Thread.sleep(SSE_SUBSCRIPTION_DELAY_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        // AI usage limits: one check per user turn, before any model call. A refusal is
        // shown in the chat (the limit's own message) and the session waits for the next
        // message; a pending tool call is left in place for when the limit allows again.
        AuthorizeResult limit = authorizeTurn(session);
        if (AuthorizeResult.blocks(limit)) {
            String message = limit.message();
            log.info("[AgentOrchestrator] AI usage limit refused session {}: {}", sessionId, message);
            conversationManager.addAssistantMessage(session, message);
            conversationManager.setAwaitingInput(session);
            // One AWAITING_INPUT event: the dashboard renders its question as the assistant's
            // bubble and re-enables the input (a MESSAGE as well would show it twice).
            emitEvent(sessionId, AgentEvent.awaitingInput(sessionId, message, null));
            return;
        }

        // Check if there's a pending tool call awaiting confirmation
        PendingToolCall pendingCall = pendingToolCalls.remove(sessionId);
        if (pendingCall != null) {
            log.info("[AgentOrchestrator] Found pending tool call: {} for session: {}",
                    pendingCall.getToolName(), sessionId);

            // Check if user confirmed (last message should be "yes" or similar)
            String lastUserMessage = getLastUserMessage(session);
            if (lastUserMessage != null && isConfirmation(lastUserMessage)) {
                log.info("[AgentOrchestrator] User confirmed, executing pending tool");
                executePendingToolCall(session, pendingCall);
            } else {
                log.info("[AgentOrchestrator] User declined or unclear, cancelling tool");
                conversationManager.addAssistantMessage(session,
                        "Okay, I've cancelled that action. What else can I help you with?");
                emitEvent(sessionId, AgentEvent.message(sessionId,
                        "Okay, I've cancelled that action. What else can I help you with?"));
                conversationManager.setAwaitingInput(session);
                emitEvent(sessionId, AgentEvent.awaitingInput(sessionId, "What else can I help you with?", null));
                return;
            }
        }

        int loopCount = 0;

        try {
            while (loopCount < MAX_LOOPS) {
                loopCount++;
                log.info("[AgentOrchestrator] Loop iteration {} for session: {}", loopCount, sessionId);

                // Send thinking event
                emitEvent(sessionId, AgentEvent.thinking(sessionId, "Analyzing request..."));

                // Call LLM
                LLMService.LLMResponse llmResponse = llmService.generateChatCompletion(session);

                // Check if LLM wants to use tools
                if (llmResponse.isHasToolCalls()) {
                    // Process each tool call
                    for (LLMService.ToolCall toolCall : llmResponse.getToolCalls()) {
                        processToolCall(session, toolCall);
                    }
                    // Continue loop - LLM will see tool results and decide next action

                } else {
                    // LLM responded with text (not tool call)
                    String content = llmResponse.getContent();

                    if (content != null) {
                        conversationManager.addAssistantMessage(session, content);

                        // Check if this is a question/confirmation request
                        if (isAwaitingUserInput(content)) {
                            conversationManager.setAwaitingInput(session);
                            emitEvent(sessionId, AgentEvent.awaitingInput(sessionId, content, null));
                            log.info("[AgentOrchestrator] Awaiting user input for session: {}", sessionId);
                            return; // Exit loop, wait for user response
                        } else {
                            // Regular message
                            emitEvent(sessionId, AgentEvent.message(sessionId, content));
                        }
                    }

                    // Check if task is complete
                    if ("stop".equals(llmResponse.getFinishReason())) {
                        conversationManager.completeSession(session);
                        emitEvent(sessionId, AgentEvent.complete(sessionId, "Task completed"));
                        log.info("[AgentOrchestrator] Session completed: {}", sessionId);
                        return;
                    }
                }
            }

            // Max loops reached
            String message = "I've taken too many steps. Let me summarize what I've done and you can guide me further.";
            conversationManager.addAssistantMessage(session, message);
            conversationManager.setAwaitingInput(session);
            emitEvent(sessionId, AgentEvent.awaitingInput(sessionId, message, null));

        } catch (Exception e) {
            log.error("[AgentOrchestrator] Error in agent loop for session: {}: {}", sessionId, e.getMessage(), e);
            conversationManager.errorSession(session, e.getMessage());
            emitEvent(sessionId, AgentEvent.error(sessionId, "Error: " + e.getMessage()));
        }
    }

    /**
     * The limit gate for one agent turn. Never throws: no limits on for the institute = no
     * call at all, and any failure = allowed.
     */
    AuthorizeResult authorizeTurn(ConversationSession session) {
        try {
            Object configured = session.getContext() == null ? null : session.getContext().get(LLMService.CTX_USE_CASE);
            String useCase = configured instanceof String s && !s.isBlank() ? s : LLMService.DEFAULT_USE_CASE;
            return creditClient.authorize(session.getInstituteId(), useCase, RequestType.AGENT.getValue(),
                    MeteringFields.user(useCase, MeteringFields.SURFACE_ADMIN_APP).build(), session.getUserId());
        } catch (Exception e) {
            return AuthorizeResult.ALLOW_NONE;
        }
    }

    /**
     * Process a tool call from the LLM
     */
    private void processToolCall(ConversationSession session, LLMService.ToolCall toolCall) {
        String sessionId = session.getSessionId();
        String toolName = toolCall.getName();
        Map<String, Object> args = toolCall.getArguments();

        log.info("[AgentOrchestrator] Processing tool call: {} with args: {}", toolName, args);

        // Find the tool definition
        ConversationSession.ToolDefinition toolDef = session.getPinnedTools().stream()
                .filter(t -> t.getName().equals(toolName))
                .findFirst()
                .orElse(null);

        if (toolDef == null) {
            log.warn("[AgentOrchestrator] Tool not found: {}", toolName);
            conversationManager.addToolResult(session, toolCall.getId(), toolName,
                    "{\"error\": \"Tool not found: " + toolName + "\"}");
            emitEvent(sessionId, AgentEvent.toolResult(sessionId, toolName, null, false, "Tool not found"));
            return;
        }

        // Check if confirmation is needed
        if (toolDef.isRequiresConfirmation()) {
            // Store the pending tool call for later execution
            pendingToolCalls.put(sessionId, PendingToolCall.builder()
                    .toolCallId(toolCall.getId())
                    .toolName(toolName)
                    .arguments(args)
                    .toolDefinition(toolDef)
                    .build());

            // Add the tool call to history (but not the result yet)
            conversationManager.addToolCall(session, toolCall.getId(), toolName, args);

            // Ask for confirmation
            String confirmMessage = String.format(
                    "I'm about to execute **%s**.\n\nThis action: %s\n\nWith parameters: %s\n\nDo you want me to proceed?",
                    toolDef.getName(),
                    toolDef.getDescription(),
                    formatArguments(args));

            conversationManager.addAssistantMessage(session, confirmMessage);
            conversationManager.setAwaitingInput(session);

            emitEvent(sessionId, AgentEvent.awaitingInput(sessionId, confirmMessage,
                    List.of(
                            AgentEvent.ConfirmationOption.builder()
                                    .id("yes").label("Yes, proceed").description("Execute this action").build(),
                            AgentEvent.ConfirmationOption.builder()
                                    .id("no").label("No, cancel").description("Cancel this action").build())));

            return;
        }

        // Execute the tool
        emitEvent(sessionId, AgentEvent.toolCall(sessionId, toolName, toolDef.getDescription(), args));

        conversationManager.addToolCall(session, toolCall.getId(), toolName, args);

        ToolExecutor.ToolExecutionResult result = toolExecutor.execute(toolDef, args, session);

        if (result.isSuccess()) {
            conversationManager.addToolResult(session, toolCall.getId(), toolName, result.getResult());
            emitEvent(sessionId, AgentEvent.toolResult(sessionId, toolName,
                    summarizeResult(result.getResult()), true, null));
        } else {
            conversationManager.addToolResult(session, toolCall.getId(), toolName,
                    "{\"error\": \"" + result.getError() + "\"}");
            emitEvent(sessionId, AgentEvent.toolResult(sessionId, toolName, null, false, result.getError()));
        }
    }

    /**
     * Check if the LLM response is asking for user input
     */
    private boolean isAwaitingUserInput(String content) {
        if (content == null)
            return false;
        String lower = content.toLowerCase();

        // Check for question patterns
        return lower.contains("?") && (lower.contains("confirm") ||
                lower.contains("proceed") ||
                lower.contains("would you like") ||
                lower.contains("do you want") ||
                lower.contains("should i") ||
                lower.contains("is this") ||
                lower.contains("are you sure") ||
                lower.contains("please select") ||
                lower.contains("which one"));
    }

    /**
     * Emit an SSE event
     */
    private void emitEvent(String sessionId, AgentEvent event) {
        SseEmitter emitter = emitters.get(sessionId);
        if (emitter != null) {
            try {
                emitter.send(SseEmitter.event()
                        .name(event.getEventType())
                        .data(event));
            } catch (IOException e) {
                log.error("[AgentOrchestrator] Error sending SSE event: {}", e.getMessage());
                emitters.remove(sessionId);
            }
        }
    }

    /**
     * Format arguments for display
     */
    private String formatArguments(Map<String, Object> args) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Object> entry : args.entrySet()) {
            sb.append("- ").append(entry.getKey()).append(": ").append(entry.getValue()).append("\n");
        }
        return sb.toString();
    }

    /**
     * Summarize a long result for display
     */
    private Object summarizeResult(String result) {
        if (result == null)
            return null;
        if (result.length() <= 500)
            return result;
        return result.substring(0, 500) + "... (truncated)";
    }

    /**
     * Get the last user message from the session history
     */
    private String getLastUserMessage(ConversationSession session) {
        List<ConversationSession.ChatMessage> history = session.getHistory();
        for (int i = history.size() - 1; i >= 0; i--) {
            ConversationSession.ChatMessage msg = history.get(i);
            if ("user".equals(msg.getRole())) {
                return msg.getContent();
            }
        }
        return null;
    }

    /**
     * Check if the message is a confirmation (yes, confirm, proceed, etc.)
     */
    private boolean isConfirmation(String message) {
        if (message == null)
            return false;
        String lower = message.toLowerCase().trim();
        return lower.equals("yes") ||
                lower.equals("y") ||
                lower.equals("confirm") ||
                lower.equals("proceed") ||
                lower.equals("ok") ||
                lower.equals("okay") ||
                lower.equals("sure") ||
                lower.equals("go ahead") ||
                lower.startsWith("yes,") ||
                lower.startsWith("yes ") ||
                lower.contains("yes, proceed") ||
                lower.contains("go ahead");
    }

    /**
     * Execute a pending tool call after user confirmation
     */
    private void executePendingToolCall(ConversationSession session, PendingToolCall pendingCall) {
        String sessionId = session.getSessionId();
        String toolName = pendingCall.getToolName();
        Map<String, Object> args = pendingCall.getArguments();
        ConversationSession.ToolDefinition toolDef = pendingCall.getToolDefinition();

        // Execute the tool
        emitEvent(sessionId, AgentEvent.toolCall(sessionId, toolName, toolDef.getDescription(), args));

        ToolExecutor.ToolExecutionResult result = toolExecutor.execute(toolDef, args, session);

        if (result.isSuccess()) {
            conversationManager.addToolResult(session, pendingCall.getToolCallId(), toolName, result.getResult());
            emitEvent(sessionId, AgentEvent.toolResult(sessionId, toolName,
                    summarizeResult(result.getResult()), true, null));
        } else {
            conversationManager.addToolResult(session, pendingCall.getToolCallId(), toolName,
                    "{\"error\": \"" + result.getError() + "\"}");
            emitEvent(sessionId, AgentEvent.toolResult(sessionId, toolName, null, false, result.getError()));
        }
    }

    /**
     * Represents a pending tool call awaiting user confirmation
     */
    @lombok.Data
    @lombok.Builder
    @lombok.NoArgsConstructor
    @lombok.AllArgsConstructor
    public static class PendingToolCall {
        private String toolCallId;
        private String toolName;
        private Map<String, Object> arguments;
        private ConversationSession.ToolDefinition toolDefinition;
    }
}
