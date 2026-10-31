package vacademy.io.notification_service.features.chatbot_flow.engine;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.chatbot_flow.entity.*;
import vacademy.io.notification_service.features.chatbot_flow.enums.ChatbotFlowStatus;
import vacademy.io.notification_service.features.chatbot_flow.enums.ChatbotNodeType;
import vacademy.io.notification_service.features.chatbot_flow.enums.ChatbotSessionStatus;
import vacademy.io.notification_service.features.chatbot_flow.repository.*;
import vacademy.io.notification_service.features.chatbot_flow.service.UserLookupService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppSendFailureService;
import vacademy.io.notification_service.features.notification_log.MessageOriginPayload;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class ChatbotFlowEngine {

    private static final int MAX_TRAVERSAL_DEPTH = 50;

    private final ChatbotFlowRepository flowRepository;
    private final ChatbotFlowNodeRepository nodeRepository;
    private final ChatbotFlowEdgeRepository edgeRepository;
    private final ChatbotFlowSessionRepository sessionRepository;
    private final ChatbotDelayTaskRepository delayTaskRepository;
    private final NotificationLogRepository notificationLogRepository;
    private final List<ChatbotNodeExecutor> executors;
    private final ObjectMapper objectMapper;
    private final UserLookupService userLookupService;
    private final WhatsAppSendFailureService sendFailureService;

    /**
     * Main entry point called from CombotWebhookService.
     * Returns true if a chatbot flow handled this message (new graph-based system).
     * Returns false to fall back to legacy ChannelFlowConfig.
     */
    /**
     * NOT @Transactional — this method makes external HTTP calls (send WhatsApp, AI).
     * DB operations use fine-grained saves. Holding a transaction during network calls
     * would exhaust the connection pool under load.
     */
    public boolean handleIncomingMessage(String instituteId, String channelType,
                                          String userPhone, String userText,
                                          String businessChannelId,
                                          String messageType, String buttonId,
                                          String buttonPayload, String listReplyId) {
        try {
            // 1. Check for an active session for this user
            Optional<ChatbotFlowSession> activeSession = sessionRepository
                    .findFirstByInstituteIdAndUserPhoneAndStatusOrderByLastActivityAtDesc(
                            instituteId, userPhone, ChatbotSessionStatus.ACTIVE.name());

            if (activeSession.isPresent()) {
                ChatbotFlowSession session = activeSession.get();

                // Check if current node is a CONDITION, AI_RESPONSE or ASK_FIELD (waiting for input)
                ChatbotFlowNode currentNode = session.getCurrentNodeId() != null
                        ? nodeRepository.findById(session.getCurrentNodeId()).orElse(null) : null;
                boolean isWaitingNode = currentNode != null && (
                        ChatbotNodeType.CONDITION.name().equals(currentNode.getNodeType())
                        || ChatbotNodeType.AI_RESPONSE.name().equals(currentNode.getNodeType())
                        || ChatbotNodeType.ASK_FIELD.name().equals(currentNode.getNodeType()));

                if (isWaitingNode) {
                    // Session is waiting for user input on a CONDITION/AI_RESPONSE node.
                    // FIRST try to resume the session with this input — the CONDITION node
                    // will evaluate whether the input matches one of its branches.
                    FlowExecutionContext context = buildContextWithUserLookup(instituteId, channelType, userPhone,
                            userText, businessChannelId, messageType, buttonId, buttonPayload,
                            listReplyId, session);

                    // Try executing the node with the user's input
                    ChatbotNodeExecutor executor = findExecutor(currentNode.getNodeType());
                    if (executor != null) {
                        // Tell the node this is the reply it was waiting for (ASK_FIELD uses it to
                        // tell "answer" from "ask"); clear it at once so nodes reached next in this
                        // same turn are executed as fresh arrivals.
                        context.setReplyToWaitingNode(true);
                        NodeExecutionResult condResult = executor.execute(currentNode, session,
                                userText, context);
                        context.setReplyToWaitingNode(false);
                        if (condResult.isSuccess()) {
                            // Log outgoing message (esp. AI_RESPONSE replies) so they appear
                            // in the WhatsApp Inbox / chat view. Without this, AI turns inside
                            // an active session are sent to WhatsApp but never persisted.
                            logOutgoingMessage(currentNode, context, condResult);

                            // Always merge output variables (e.g., AI conversation history)
                            mergeSessionContext(session, condResult.getOutputVariables());

                            if (condResult.isWaitForInput()
                                    && (ChatbotNodeType.AI_RESPONSE.name().equals(currentNode.getNodeType())
                                        || ChatbotNodeType.ASK_FIELD.name().equals(currentNode.getNodeType()))) {
                                // AI_RESPONSE wants to stay in conversation mode; ASK_FIELD re-asked
                                // after an invalid answer and waits for another try.
                                // History is already saved via mergeSessionContext above
                                session.setLastActivityAt(new Timestamp(System.currentTimeMillis()));
                                sessionRepository.save(session);
                                return true;
                            }

                            if (!condResult.isWaitForInput()) {
                                // Node matched a branch or exited — advance to next node
                                log.info("Node matched in active session — resuming flow: "
                                        + "sessionId={}, branchId={}",
                                        session.getId(), condResult.getSelectedBranchId());
                                advanceToNextNodes(session, currentNode.getId(),
                                        condResult.getSelectedBranchId(), condResult.isStrictBranch(), context, 0);
                                return true;
                            }

                            // CONDITION returned waitForInput=true (no branch matched)
                            // Fall through to trigger-restart check below
                        }
                    }

                    // Node execution failed or CONDITION didn't match any branch.
                    // Check if input matches ANY flow's trigger (including current flow).
                    // If it matches, restart — the user is clearly trying to start over.
                    String matchedFlowId = findMatchingTriggerFlowId(instituteId, channelType,
                            userText, messageType, buttonId, buttonPayload, listReplyId);

                    if (matchedFlowId != null) {
                        log.info("Input matches trigger for flow={} while stuck on {} node "
                                + "— restarting session", matchedFlowId, currentNode.getNodeType());
                        completeSession(session);
                        // Fall through to trigger matching below to start a new flow
                    } else {
                        // No trigger matches — stay on current node waiting for valid input
                        log.info("No trigger matched — staying on current {} node: sessionId={}",
                                currentNode.getNodeType(), session.getId());
                        return true;
                    }
                } else {
                    // Not on a waiting node — check if a trigger keyword matches to restart
                    boolean matchesTrigger = doesMessageMatchAnyTrigger(instituteId, channelType,
                            userText, messageType, buttonId, buttonPayload, listReplyId);

                    if (matchesTrigger) {
                        // Not on a waiting node, just resume normally
                        FlowExecutionContext context = buildContextWithUserLookup(instituteId, channelType, userPhone,
                                userText, businessChannelId, messageType, buttonId, buttonPayload,
                                listReplyId, session);
                        resumeSession(session, context);
                        return true;
                    } else {
                        // Message doesn't match any trigger — resume current session
                        log.info("Resuming chatbot flow session: sessionId={}, flowId={}, currentNode={}",
                                session.getId(), session.getFlowId(), session.getCurrentNodeId());

                        FlowExecutionContext context = buildContextWithUserLookup(instituteId, channelType, userPhone,
                                userText, businessChannelId, messageType, buttonId, buttonPayload,
                                listReplyId, session);

                        resumeSession(session, context);
                        return true;
                    }
                }
            }

            // 2. No active session — check if any ACTIVE flow has a matching trigger
            // Search across all WhatsApp channel types for this institute:
            // exact match first, then generic "WHATSAPP", then other WA variants
            List<ChatbotFlow> activeFlows = new ArrayList<>(flowRepository
                    .findByInstituteIdAndChannelTypeAndStatus(instituteId, channelType,
                            ChatbotFlowStatus.ACTIVE.name()));

            // Also check flows with generic "WHATSAPP" channel type
            if (!channelType.equals("WHATSAPP")) {
                activeFlows.addAll(flowRepository.findByInstituteIdAndChannelTypeAndStatus(
                        instituteId, "WHATSAPP", ChatbotFlowStatus.ACTIVE.name()));
            }

            // Cross-provider fallback: a flow built for WATI should also fire for META and vice versa
            // (the flow logic is provider-agnostic, only the send mechanism differs)
            for (String fallbackType : List.of("WHATSAPP_META", "WHATSAPP_WATI", "WHATSAPP_COMBOT")) {
                if (!fallbackType.equals(channelType)) {
                    activeFlows.addAll(flowRepository.findByInstituteIdAndChannelTypeAndStatus(
                            instituteId, fallbackType, ChatbotFlowStatus.ACTIVE.name()));
                }
            }

            // Deduplicate by flow ID (in case same flow was found through multiple channel type queries)
            Set<String> seenFlowIds = new HashSet<>();
            activeFlows.removeIf(f -> !seenFlowIds.add(f.getId()));

            log.info("Found {} active flows for institute={}, channelType={}", activeFlows.size(), instituteId, channelType);

            // Collect all matching triggers with their priority, then pick the highest
            record MatchedTrigger(ChatbotFlow flow, ChatbotFlowNode triggerNode, int priority,
                                  boolean isSpecific) {}
            List<MatchedTrigger> matchedTriggers = new ArrayList<>();

            for (ChatbotFlow flow : activeFlows) {
                List<ChatbotFlowNode> triggerNodes = nodeRepository
                        .findByFlowIdAndNodeType(flow.getId(), ChatbotNodeType.TRIGGER.name());

                for (ChatbotFlowNode triggerNode : triggerNodes) {
                    ChatbotNodeExecutor executor = findExecutor(triggerNode.getNodeType());
                    if (executor == null) continue;

                    FlowExecutionContext context = buildContext(instituteId, channelType, userPhone,
                            userText, businessChannelId, messageType, buttonId, buttonPayload,
                            listReplyId, null);

                    NodeExecutionResult result = executor.execute(triggerNode, null, userText, context);
                    if (result.isSuccess()) {
                        Map<String, Object> triggerConfig = parseJson(triggerNode.getConfig());
                        int priority = 0;
                        boolean isSpecific = false;
                        if (triggerConfig != null) {
                            Object p = triggerConfig.get("priority");
                            if (p instanceof Number) priority = ((Number) p).intValue();
                            // A trigger with actual keywords is "specific"; one without is catch-all
                            Object keywords = triggerConfig.get("keywords");
                            isSpecific = keywords instanceof List && !((List<?>) keywords).isEmpty();
                        }
                        matchedTriggers.add(new MatchedTrigger(flow, triggerNode, priority, isSpecific));
                    }
                }
            }

            if (!matchedTriggers.isEmpty()) {
                // Sort: specific triggers first, then by priority descending
                matchedTriggers.sort((a, b) -> {
                    if (a.isSpecific() != b.isSpecific()) return a.isSpecific() ? -1 : 1;
                    return Integer.compare(b.priority(), a.priority());
                });

                MatchedTrigger best = matchedTriggers.get(0);
                log.info("Trigger matched for flow: flowId={}, trigger={}, priority={}, specific={}",
                        best.flow().getId(), best.triggerNode().getName(),
                        best.priority(), best.isSpecific());

                // Fetch user details once. Persist them into the new session's initial
                // context JSON so subsequent turns hit the cache instead of re-fetching.
                Map<String, Object> initialSessionVars = new HashMap<>();
                Map<String, Object> userDetails = userLookupService.fetchUserByPhone(userPhone);
                if (userDetails != null) {
                    initialSessionVars.put("__userDetails", userDetails);
                }

                ChatbotFlowSession session = ChatbotFlowSession.builder()
                        .flowId(best.flow().getId())
                        .instituteId(instituteId)
                        .userPhone(userPhone)
                        .channelType(channelType)
                        .businessChannelId(businessChannelId)
                        .currentNodeId(best.triggerNode().getId())
                        .status(ChatbotSessionStatus.ACTIVE.name())
                        .context(toJson(initialSessionVars))
                        .lastActivityAt(new Timestamp(System.currentTimeMillis()))
                        .build();
                session = sessionRepository.save(session);

                FlowExecutionContext context = FlowExecutionContext.builder()
                        .instituteId(instituteId)
                        .channelType(channelType)
                        .phoneNumber(userPhone)
                        .messageText(userText)
                        .businessChannelId(businessChannelId)
                        .messageType(messageType != null ? messageType : "text")
                        .buttonId(buttonId)
                        .buttonPayload(buttonPayload)
                        .listReplyId(listReplyId)
                        .sessionVariables(initialSessionVars)
                        .userDetails(userDetails)
                        .build();

                // Advance past the trigger node to the next node(s)
                advanceToNextNodes(session, best.triggerNode().getId(), null, context, 0);
                return true;
            }

            // 3. No flow matched — fall back to legacy
            log.info("No chatbot flow matched for phone={}, institute={}, text='{}'",
                    userPhone, instituteId, userText != null ? userText.substring(0, Math.min(userText.length(), 30)) : "null");
            return false;

        } catch (Exception e) {
            log.error("Error in ChatbotFlowEngine.handleIncomingMessage: {}", e.getMessage(), e);
            return false;
        }
    }

    /**
     * Resume an existing session: execute the current node with user's input,
     * then advance to next nodes.
     */
    private void resumeSession(ChatbotFlowSession session, FlowExecutionContext context) {
        String currentNodeId = session.getCurrentNodeId();
        ChatbotFlowNode currentNode = nodeRepository.findById(currentNodeId).orElse(null);
        if (currentNode == null) {
            log.error("Current node not found: nodeId={}, sessionId={}, flowId={} — "
                    + "likely flow was edited while session was active. Completing session.",
                    currentNodeId, session.getId(), session.getFlowId());
            completeSession(session);
            return;
        }

        ChatbotNodeExecutor executor = findExecutor(currentNode.getNodeType());
        if (executor == null) {
            log.error("No executor for node type: {}", currentNode.getNodeType());
            completeSession(session);
            return;
        }

        NodeExecutionResult result = executor.execute(currentNode, session, context.getMessageText(), context);

        if (!result.isSuccess()) {
            log.warn("Node execution failed: nodeId={}, error={}", currentNodeId, result.getErrorMessage());
            // A send node that failed means the learner never got this message — record it so the
            // gap is visible in the WhatsApp Inbox instead of silently disappearing.
            logFailedOutgoingMessage(currentNode, context, result.getErrorMessage());
            // Don't complete session on failure — let user retry
            return;
        }

        // Log outgoing message so it appears in WhatsApp Inbox
        logOutgoingMessage(currentNode, context, result);

        // Merge output variables into session context
        mergeSessionContext(session, result.getOutputVariables());

        if (result.isWaitForInput()) {
            // Node needs more input (e.g., AI_RESPONSE in conversation mode)
            // Stay on this node, don't advance
            session.setLastActivityAt(new Timestamp(System.currentTimeMillis()));
            sessionRepository.save(session);
            return;
        }

        if (result.isScheduleDelay()) {
            // DELAY node: create a delayed task and pause
            ChatbotDelayTask delayTask = ChatbotDelayTask.builder()
                    .sessionId(session.getId())
                    .flowId(session.getFlowId())
                    .nextNodeId(currentNodeId) // Will resolve actual next node when firing
                    .fireAt(result.getDelayUntil())
                    .status("PENDING")
                    .build();
            delayTaskRepository.save(delayTask);

            session.setLastActivityAt(new Timestamp(System.currentTimeMillis()));
            sessionRepository.save(session);
            return;
        }

        // Advance to next node(s)
        advanceToNextNodes(session, currentNodeId, result.getSelectedBranchId(), result.isStrictBranch(),
                context, 0);
    }

    /**
     * Follow outgoing edges from current node and execute subsequent nodes.
     * Handles branching (CONDITION) and linear flows.
     * Uses depth counter to prevent infinite loops in cyclic graphs.
     */
    private void advanceToNextNodes(ChatbotFlowSession session, String fromNodeId,
                                     String selectedBranchId, FlowExecutionContext context, int depth) {
        advanceToNextNodes(session, fromNodeId, selectedBranchId, false, context, depth);
    }

    /**
     * @param strictBranch follow only an edge whose branchId equals {@code selectedBranchId}; when
     *                     none is connected the flow ends instead of falling back to the default /
     *                     first edge (see {@link NodeExecutionResult#isStrictBranch()}).
     */
    private void advanceToNextNodes(ChatbotFlowSession session, String fromNodeId,
                                     String selectedBranchId, boolean strictBranch,
                                     FlowExecutionContext context, int depth) {
        if (depth >= MAX_TRAVERSAL_DEPTH) {
            log.error("Max traversal depth ({}) reached for session {}, completing to prevent infinite loop",
                    MAX_TRAVERSAL_DEPTH, session.getId());
            completeSession(session);
            return;
        }

        List<ChatbotFlowEdge> outgoingEdges = edgeRepository.findBySourceNodeIdOrderBySortOrder(fromNodeId);

        if (outgoingEdges.isEmpty()) {
            // No more edges — flow complete
            completeSession(session);
            return;
        }

        // For CONDITION nodes: filter edges by branch ID
        ChatbotFlowEdge nextEdge = null;
        if (selectedBranchId != null && strictBranch) {
            nextEdge = outgoingEdges.stream()
                    .filter(e -> {
                        Map<String, Object> config = parseJson(e.getConditionConfig());
                        return config != null && selectedBranchId.equals(config.get("branchId"));
                    })
                    .findFirst()
                    .orElse(null);
        } else if (selectedBranchId != null) {
            nextEdge = outgoingEdges.stream()
                    .filter(e -> {
                        Map<String, Object> config = parseJson(e.getConditionConfig());
                        return config != null && selectedBranchId.equals(config.get("branchId"));
                    })
                    .findFirst()
                    // Fallback to default branch
                    .orElseGet(() -> outgoingEdges.stream()
                            .filter(e -> {
                                Map<String, Object> config = parseJson(e.getConditionConfig());
                                return config != null && Boolean.TRUE.equals(config.get("isDefault"));
                            })
                            .findFirst()
                            .orElse(outgoingEdges.isEmpty() ? null : outgoingEdges.get(0)));
        } else {
            // Non-branching node: take the first (and usually only) edge
            nextEdge = outgoingEdges.get(0);
        }

        if (nextEdge == null) {
            completeSession(session);
            return;
        }

        String nextNodeId = nextEdge.getTargetNodeId();
        ChatbotFlowNode nextNode = nodeRepository.findById(nextNodeId).orElse(null);
        if (nextNode == null) {
            log.error("Next node not found: {}", nextNodeId);
            completeSession(session);
            return;
        }

        // Update session to point to next node
        session.setCurrentNodeId(nextNodeId);
        session.setLastActivityAt(new Timestamp(System.currentTimeMillis()));
        sessionRepository.save(session);

        // Execute the next node if it's an "auto-execute" type (not waiting for input)
        if (isAutoExecuteNode(nextNode.getNodeType())) {
            ChatbotNodeExecutor executor = findExecutor(nextNode.getNodeType());
            if (executor != null) {
                NodeExecutionResult result = executor.execute(nextNode, session, context.getMessageText(), context);
                if (result.isSuccess()) {
                    // Log outgoing message so it appears in WhatsApp Inbox
                    logOutgoingMessage(nextNode, context, result);
                    mergeSessionContext(session, result.getOutputVariables());

                    if (result.isWaitForInput()) {
                        // Node will wait for user input (e.g., CONDITION after sending interactive)
                        sessionRepository.save(session);
                        return;
                    }
                    if (result.isScheduleDelay()) {
                        // Store the DELAY node's own ID — resumeAfterDelay calls
                        // advanceToNextNodes(storedId) which finds outgoing edges
                        // from this node and executes the target. Storing nextNodeId
                        // here would SKIP the target and jump two nodes ahead.
                        ChatbotDelayTask delayTask = ChatbotDelayTask.builder()
                                .sessionId(session.getId())
                                .flowId(session.getFlowId())
                                .nextNodeId(nextNodeId)  // This IS the delay node (set at line 365)
                                .fireAt(result.getDelayUntil())
                                .status("PENDING")
                                .build();
                        delayTaskRepository.save(delayTask);
                        sessionRepository.save(session);
                        return;
                    }
                    // Continue advancing
                    advanceToNextNodes(session, nextNodeId, result.getSelectedBranchId(), result.isStrictBranch(),
                            context, depth + 1);
                } else {
                    // Send refused by the provider — record the undelivered message so it shows
                    // up in the Inbox rather than leaving a hole in the conversation.
                    log.warn("Node execution failed while advancing: nodeId={}, error={}",
                            nextNodeId, result.getErrorMessage());
                    logFailedOutgoingMessage(nextNode, context, result.getErrorMessage());
                }
            }
        }
        // If not auto-execute (CONDITION), session stays at this node waiting for input
    }

    /**
     * Nodes that execute immediately without waiting for user input.
     */
    private boolean isAutoExecuteNode(String nodeType) {
        return ChatbotNodeType.SEND_TEMPLATE.name().equals(nodeType)
                || ChatbotNodeType.SEND_MESSAGE.name().equals(nodeType)
                || ChatbotNodeType.SEND_INTERACTIVE.name().equals(nodeType)
                || ChatbotNodeType.WORKFLOW_ACTION.name().equals(nodeType)
                || ChatbotNodeType.DELAY.name().equals(nodeType)
                || ChatbotNodeType.HTTP_WEBHOOK.name().equals(nodeType)
                || ChatbotNodeType.AI_RESPONSE.name().equals(nodeType)
                || ChatbotNodeType.CRM_LEAD_CHECK.name().equals(nodeType)
                || ChatbotNodeType.ASK_FIELD.name().equals(nodeType)
                || ChatbotNodeType.SAVE_TO_CRM.name().equals(nodeType);
    }

    /**
     * Resume execution after a DELAY task fires.
     */
    public void resumeAfterDelay(ChatbotDelayTask task) {
        ChatbotFlowSession session = sessionRepository.findById(task.getSessionId()).orElse(null);
        if (session == null || !ChatbotSessionStatus.ACTIVE.name().equals(session.getStatus())) {
            log.warn("Session not active for delay task: {}", task.getId());
            return;
        }

        Map<String, Object> sessionVars = parseJson(session.getContext());
        Map<String, Object> userDetails = ensureUserDetails(sessionVars, session.getUserPhone(), session);

        FlowExecutionContext context = FlowExecutionContext.builder()
                .instituteId(session.getInstituteId())
                .phoneNumber(session.getUserPhone())
                .userId(session.getUserId())
                .channelType(session.getChannelType())
                .businessChannelId(session.getBusinessChannelId())
                .sessionVariables(sessionVars)
                .userDetails(userDetails)
                .build();

        advanceToNextNodes(session, task.getNextNodeId(), null, context, 0);
    }

    // ==================== Helpers ====================

    /**
     * Check if the incoming message matches ANY active flow's trigger for this institute.
     * Used to decide if an active session should be restarted.
     */
    private boolean doesMessageMatchAnyTrigger(String instituteId, String channelType,
                                                String userText, String messageType,
                                                String buttonId, String buttonPayload, String listReplyId) {
        return findMatchingTriggerFlowId(instituteId, channelType, userText,
                messageType, buttonId, buttonPayload, listReplyId) != null;
    }

    /**
     * Find the flow ID of the best matching trigger for this message.
     * Returns the flow ID of the highest-priority, most-specific matching trigger,
     * or null if no trigger matches.
     */
    private String findMatchingTriggerFlowId(String instituteId, String channelType,
                                             String userText, String messageType,
                                             String buttonId, String buttonPayload, String listReplyId) {
        // Collect all active flows (same logic as main trigger scan)
        List<ChatbotFlow> activeFlows = new ArrayList<>(flowRepository
                .findByInstituteIdAndChannelTypeAndStatus(instituteId, channelType,
                        ChatbotFlowStatus.ACTIVE.name()));
        if (!channelType.equals("WHATSAPP")) {
            activeFlows.addAll(flowRepository.findByInstituteIdAndChannelTypeAndStatus(
                    instituteId, "WHATSAPP", ChatbotFlowStatus.ACTIVE.name()));
        }
        for (String fallbackType : List.of("WHATSAPP_META", "WHATSAPP_WATI", "WHATSAPP_COMBOT")) {
            if (!fallbackType.equals(channelType)) {
                activeFlows.addAll(flowRepository.findByInstituteIdAndChannelTypeAndStatus(
                        instituteId, fallbackType, ChatbotFlowStatus.ACTIVE.name()));
            }
        }

        FlowExecutionContext ctx = FlowExecutionContext.builder()
                .messageType(messageType).buttonId(buttonId)
                .buttonPayload(buttonPayload).listReplyId(listReplyId)
                .build();

        // Track the best matching trigger: prefer specific (has keywords) over catch-all,
        // then by priority
        String bestFlowId = null;
        int bestPriority = Integer.MIN_VALUE;
        boolean bestIsSpecific = false;

        for (ChatbotFlow flow : activeFlows) {
            List<ChatbotFlowNode> triggerNodes = nodeRepository
                    .findByFlowIdAndNodeType(flow.getId(), ChatbotNodeType.TRIGGER.name());
            for (ChatbotFlowNode triggerNode : triggerNodes) {
                ChatbotNodeExecutor executor = findExecutor(triggerNode.getNodeType());
                if (executor != null) {
                    NodeExecutionResult result = executor.execute(triggerNode, null, userText, ctx);
                    if (result.isSuccess()) {
                        Map<String, Object> triggerConfig = parseJson(triggerNode.getConfig());
                        int priority = 0;
                        boolean isSpecific = false;
                        if (triggerConfig != null) {
                            Object p = triggerConfig.get("priority");
                            if (p instanceof Number) priority = ((Number) p).intValue();
                            Object keywords = triggerConfig.get("keywords");
                            isSpecific = keywords instanceof List && !((List<?>) keywords).isEmpty();
                        }

                        // Better match if: (a) this is specific and best isn't, or
                        // (b) same specificity but higher priority
                        if ((!bestIsSpecific && isSpecific)
                                || (isSpecific == bestIsSpecific && priority > bestPriority)
                                || bestFlowId == null) {
                            bestFlowId = flow.getId();
                            bestPriority = priority;
                            bestIsSpecific = isSpecific;
                        }
                    }
                }
            }
        }
        return bestFlowId;
    }

    /**
     * Log outgoing messages from SEND_* and AI_RESPONSE nodes so they appear in WhatsApp Inbox.
     */
    private void logOutgoingMessage(ChatbotFlowNode node, FlowExecutionContext context,
                                     NodeExecutionResult result) {
        try {
            String nodeType = node.getNodeType();
            // CRM nodes build their message at run time and may send nothing at all this turn
            // (e.g. ASK_FIELD accepting an answer): log exactly what they report having sent.
            String crmSentBody = null;
            if (isCrmNode(nodeType)) {
                crmSentBody = context.getLastSentBody();
                context.setLastSentBody(null);
                if (crmSentBody == null) {
                    context.setLastProviderMessageId(null);
                    return;
                }
            } else if (!nodeType.startsWith("SEND_") && !ChatbotNodeType.AI_RESPONSE.name().equals(nodeType)) {
                // Only log for send nodes and AI response
                return;
            }

            // The executor already wrote a FAILED row for this attempt (provider refused the
            // send). Logging a second, delivered-looking row would show the learner a message
            // they never received. Read-and-clear so the next node in the chain still logs.
            if (context.isSendFailureLogged()) {
                context.setSendFailureLogged(false);
                // Drop any id from an earlier message of this same node — no row is written here,
                // and a leftover id would end up on the NEXT node's row, giving one message the
                // ticks of another.
                context.setLastProviderMessageId(null);
                context.setLastTemplateSend(null);
                return;
            }

            // Extract the actual message body that was sent
            String messageBody = node.getName();

            // For AI_RESPONSE: use the actual LLM-generated reply from output variables
            if (crmSentBody != null) {
                messageBody = crmSentBody;
            } else if (ChatbotNodeType.AI_RESPONSE.name().equals(nodeType)
                    && result != null && result.getOutputVariables() != null) {
                Object aiReply = result.getOutputVariables().get("ai_last_response");
                if (aiReply != null) {
                    messageBody = aiReply.toString();
                }
            } else {
                // For SEND_* nodes: extract from config
                messageBody = describeNodeMessage(node);
            }

            NotificationLog outLog = new NotificationLog();
            outLog.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
            outLog.setChannelId(context.getPhoneNumber());
            outLog.setBody(messageBody);
            outLog.setSource("CHATBOT_FLOW");
            // The provider message id from the send this row describes. It is the only key the
            // sent/delivered/read webhooks join on, so without it a bot reply keeps a single grey
            // tick no matter how many status events arrive. Read-and-clear, like sendFailureLogged,
            // so the next node in the chain cannot inherit this node's id.
            outLog.setSourceId(context.getLastProviderMessageId());
            context.setLastProviderMessageId(null);
            // A template send keeps its name and params, so the Inbox renders the real message
            // (header image, body, buttons) rather than the "Template: name" body line; every
            // bot message keeps which flow sent it.
            outLog.setMessagePayload(toJson(logPayload(takeTemplateSend(context), node)));
            outLog.setSenderBusinessChannelId(context.getBusinessChannelId());
            outLog.setNotificationDate(Instant.now());
            outLog.setUserId(context.getUserId());
            // Stamp institute_id so this outgoing bot message is visible in the WA Inbox
            // conversation view, which filters rows by institute_id.
            outLog.setInstituteId(context.getInstituteId());

            notificationLogRepository.save(outLog);
        } catch (Exception e) {
            log.warn("Failed to log outgoing message for node {}: {}", node.getId(), e.getMessage());
        }
    }

    /**
     * The message text a SEND_* node is configured to deliver, for the Inbox bubble. Falls back to
     * the node's display name when the config carries nothing recognisable.
     */
    private String describeNodeMessage(ChatbotFlowNode node) {
        String messageBody = node.getName();
        Map<String, Object> config = parseJson(node.getConfig());
        if (config != null) {
            if (config.containsKey("text")) {
                messageBody = (String) config.get("text");
            } else if (config.containsKey("templateName")) {
                messageBody = "Template: " + config.get("templateName");
            } else if (config.containsKey("body")) {
                messageBody = (String) config.get("body");
            } else if (config.containsKey("mediaUrl")) {
                messageBody = "[" + config.getOrDefault("messageType", "media") + "] "
                        + config.getOrDefault("mediaCaption", config.get("mediaUrl"));
            } else if (config.containsKey("question")) {
                // ASK_FIELD — only reached for its undelivered-question row
                messageBody = (String) config.get("question");
            }
        }
        return messageBody;
    }

    /**
     * Record a send node whose provider call was refused. Writes a FAILED row through
     * {@link WhatsAppSendFailureService} so the WhatsApp Inbox can show the message as not
     * delivered — previously these attempts vanished into the application log only.
     */
    private void logFailedOutgoingMessage(ChatbotFlowNode node, FlowExecutionContext context,
                                          String error) {
        if (node == null || context == null) return;
        String nodeType = node.getNodeType();
        // Read-and-clear up front, so no exit below can leave it for the next node.
        Map<String, Object> templateSend = takeTemplateSend(context);
        if (nodeType == null) return;
        if (ChatbotNodeType.ASK_FIELD.name().equals(nodeType)) {
            // The question never reached the user — show it as undelivered in the Inbox.
            context.setLastSentBody(null);
        } else if (!nodeType.startsWith("SEND_")) {
            return;
        }
        // The executor may already have logged it (AI_RESPONSE path); read-and-clear the flag.
        if (context.isSendFailureLogged()) {
            context.setSendFailureLogged(false);
            return;
        }
        sendFailureService.logFailure(context.getInstituteId(), context.getPhoneNumber(),
                context.getBusinessChannelId(), context.getUserId(),
                attemptedTypeOf(node), describeNodeMessage(node), "CHATBOT_FLOW", error,
                logPayload(templateSend, node));
    }

    /**
     * The log row's payload: what a template node sent, plus the flow that sent it, so the Inbox
     * and the student timeline can say "sent by chatbot flow X". The flow's name is looked up
     * when the row is read, so a renamed flow shows its current name.
     */
    private Map<String, Object> logPayload(Map<String, Object> templateSend, ChatbotFlowNode node) {
        Map<String, Object> payload = new LinkedHashMap<>();
        if (templateSend != null) payload.putAll(templateSend);
        if (node.getFlowId() != null) {
            payload.put(MessageOriginPayload.TYPE_KEY, MessageOriginPayload.TYPE_CHATBOT_FLOW);
            payload.put(MessageOriginPayload.ID_KEY, node.getFlowId());
        }
        return payload.isEmpty() ? null : payload;
    }

    /** The template the last SEND_TEMPLATE node sent, cleared so it is logged exactly once. */
    private Map<String, Object> takeTemplateSend(FlowExecutionContext context) {
        Map<String, Object> templateSend = context.getLastTemplateSend();
        context.setLastTemplateSend(null);
        return templateSend;
    }

    /** What kind of message the node was trying to send, for the Inbox failure bubble. */
    private String attemptedTypeOf(ChatbotFlowNode node) {
        String nodeType = node.getNodeType();
        if (ChatbotNodeType.SEND_TEMPLATE.name().equals(nodeType)) return "template";
        if (ChatbotNodeType.SEND_INTERACTIVE.name().equals(nodeType)) return "interactive";
        Map<String, Object> config = parseJson(node.getConfig());
        Object messageType = config != null ? config.get("messageType") : null;
        return messageType != null ? messageType.toString() : "text";
    }

    /** Nodes that turn a conversation into a CRM lead; they report what they sent via lastSentBody. */
    private static boolean isCrmNode(String nodeType) {
        return ChatbotNodeType.CRM_LEAD_CHECK.name().equals(nodeType)
                || ChatbotNodeType.ASK_FIELD.name().equals(nodeType)
                || ChatbotNodeType.SAVE_TO_CRM.name().equals(nodeType);
    }

    private ChatbotNodeExecutor findExecutor(String nodeType) {
        return executors.stream()
                .filter(e -> e.canHandle(nodeType))
                .findFirst()
                .orElse(null);
    }

    private void completeSession(ChatbotFlowSession session) {
        session.setStatus(ChatbotSessionStatus.COMPLETED.name());
        session.setCompletedAt(new Timestamp(System.currentTimeMillis()));
        sessionRepository.save(session);
        log.info("Flow session completed: sessionId={}", session.getId());
    }

    private void mergeSessionContext(ChatbotFlowSession session, Map<String, Object> newVars) {
        if (newVars == null || newVars.isEmpty()) return;
        Map<String, Object> existing = parseJson(session.getContext());
        if (existing == null) existing = new HashMap<>();
        existing.putAll(newVars);
        session.setContext(toJson(existing));
        sessionRepository.save(session);
    }

    /**
     * Build a flow context. By default this skips the user-details HTTP lookup
     * because most callsites (trigger scanning, etc.) don't need it. Callers that
     * are about to execute SEND_/AI_RESPONSE nodes should call
     * {@link #buildContextWithUserLookup} instead.
     */
    private FlowExecutionContext buildContext(String instituteId, String channelType,
                                              String userPhone, String userText,
                                              String businessChannelId, String messageType,
                                              String buttonId, String buttonPayload,
                                              String listReplyId, ChatbotFlowSession session) {
        Map<String, Object> sessionVars = parseJson(session != null ? session.getContext() : null);
        Map<String, Object> userDetails = readCachedUserDetails(sessionVars);
        return FlowExecutionContext.builder()
                .userId(session != null ? session.getUserId() : null)
                .instituteId(instituteId)
                .channelType(channelType)
                .phoneNumber(userPhone)
                .messageText(userText)
                .businessChannelId(businessChannelId)
                .messageType(messageType != null ? messageType : "text")
                .buttonId(buttonId)
                .buttonPayload(buttonPayload)
                .listReplyId(listReplyId)
                .sessionVariables(sessionVars)
                .userDetails(userDetails)
                .build();
    }

    /**
     * Build a flow context AND ensure user details are populated — fetching from
     * admin-core-service if not already cached on the session. The fetched data
     * is memoized in the session's context JSON under the {@code __userDetails}
     * key so subsequent turns skip the HTTP round-trip.
     */
    private FlowExecutionContext buildContextWithUserLookup(String instituteId, String channelType,
                                                            String userPhone, String userText,
                                                            String businessChannelId, String messageType,
                                                            String buttonId, String buttonPayload,
                                                            String listReplyId, ChatbotFlowSession session) {
        Map<String, Object> sessionVars = parseJson(session != null ? session.getContext() : null);
        Map<String, Object> userDetails = ensureUserDetails(sessionVars, userPhone, session);
        return FlowExecutionContext.builder()
                .userId(session != null ? session.getUserId() : null)
                .instituteId(instituteId)
                .channelType(channelType)
                .phoneNumber(userPhone)
                .messageText(userText)
                .businessChannelId(businessChannelId)
                .messageType(messageType != null ? messageType : "text")
                .buttonId(buttonId)
                .buttonPayload(buttonPayload)
                .listReplyId(listReplyId)
                .sessionVariables(sessionVars)
                .userDetails(userDetails)
                .build();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readCachedUserDetails(Map<String, Object> sessionVars) {
        if (sessionVars == null) return null;
        Object cached = sessionVars.get("__userDetails");
        return cached instanceof Map ? (Map<String, Object>) cached : null;
    }

    /**
     * Return cached user details from {@code sessionVars} if present, otherwise
     * fetch from admin-core-service and write back to both the in-memory map and
     * (if a persisted session was provided) the session row's context column.
     */
    private Map<String, Object> ensureUserDetails(Map<String, Object> sessionVars,
                                                  String userPhone,
                                                  ChatbotFlowSession session) {
        Map<String, Object> cached = readCachedUserDetails(sessionVars);
        if (cached != null) return cached;
        Map<String, Object> fetched = userLookupService.fetchUserByPhone(userPhone);
        if (fetched != null && sessionVars != null) {
            sessionVars.put("__userDetails", fetched);
            if (session != null) {
                session.setContext(toJson(sessionVars));
                sessionRepository.save(session);
            }
        }
        return fetched;
    }

    private String toJson(Object obj) {
        if (obj == null) return null;
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) return new HashMap<>();
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (JsonProcessingException e) {
            return new HashMap<>();
        }
    }
}
