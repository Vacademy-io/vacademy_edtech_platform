package vacademy.io.notification_service.features.chatbot_flow.engine.executors;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.enums.EscalationReason;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowRepository;
import vacademy.io.notification_service.features.chatbot_flow.service.ChatbotEscalationService;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Shared plumbing for the CRM chatbot nodes (CRM_LEAD_CHECK, ASK_FIELD, SAVE_TO_CRM): session
 * keys, sending, the admin-core request shape, and team alerts.
 *
 * <p>Session context keys (chatbot_flow_session.context):
 * <ul>
 *   <li>{@link #KEY_RESPONSE_ID}, {@link #KEY_USER_ID}, {@link #KEY_RESULT} — the lead this
 *       conversation is working on and whether it was NEW, EXISTING or UNKNOWN (lookup failed).</li>
 *   <li>{@link #KEY_FIELDS} — answers keyed by custom_field_id; {@link #KEY_FIELD_LABELS} — their
 *       labels (for alerts); {@link #KEY_SYSTEM} — full_name / email answers.</li>
 * </ul>
 * Executors read the session row's context directly (not {@code context.getSessionVariables()}),
 * because the engine does not refresh that map after merging a node's output in the same turn.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class CrmLeadNodeSupport {

    public static final String KEY_RESPONSE_ID = "lead_response_id";
    public static final String KEY_USER_ID = "lead_user_id";
    public static final String KEY_RESULT = "lead_result";
    public static final String KEY_FIELDS = "__lead_fields";
    public static final String KEY_FIELD_LABELS = "__lead_field_labels";
    public static final String KEY_SYSTEM = "__lead_system";

    public static final String RESULT_NEW = "NEW";
    public static final String RESULT_EXISTING = "EXISTING";
    public static final String RESULT_UNKNOWN = "UNKNOWN";

    private final ObjectMapper objectMapper;
    private final List<ChatbotMessageProvider> messageProviders;
    private final ChatbotFlowRepository flowRepository;
    private final NotificationLogRepository notificationLogRepository;
    private final ChatbotEscalationService escalationService;

    // ==================== Config / session ====================

    public Map<String, Object> parseConfig(String json) {
        if (json == null || json.isBlank()) return new HashMap<>();
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return new HashMap<>();
        }
    }

    public Map<String, Object> sessionContext(ChatbotFlowSession session) {
        return session == null ? new HashMap<>() : parseConfig(session.getContext());
    }

    public static String str(Map<String, Object> map, String key) {
        Object v = map == null ? null : map.get(key);
        return v == null ? null : v.toString();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, String> stringMap(Map<String, Object> map, String key) {
        Map<String, String> out = new LinkedHashMap<>();
        Object v = map == null ? null : map.get(key);
        if (v instanceof Map) {
            ((Map<Object, Object>) v).forEach((k, val) -> {
                if (k != null && val != null) out.put(k.toString(), val.toString());
            });
        }
        return out;
    }

    // ==================== Admin-core request ====================

    /** Fields every admin-core call carries: who, where, which flow. */
    public Map<String, Object> baseRequest(ChatbotFlowSession session, FlowExecutionContext context) {
        Map<String, Object> req = new HashMap<>();
        req.put("instituteId", context.getInstituteId());
        req.put("phone", context.getPhoneNumber());
        req.put("name", senderName(context.getInstituteId(), context.getPhoneNumber()));
        if (session != null) {
            req.put("flowId", session.getFlowId());
            req.put("flowName", flowName(session.getFlowId()));
            req.put("sessionId", session.getId());
        }
        return req;
    }

    /**
     * Remember the lead admin-core resolved: session row (user_id), the running context (so
     * messages logged later in this turn carry the user) and the node's output variables.
     */
    public void applyLead(Map<String, Object> response, ChatbotFlowSession session,
                          FlowExecutionContext context, Map<String, Object> outputVariables) {
        String responseId = str(response, "responseId");
        String userId = str(response, "userId");
        String result = str(response, "result");
        if (responseId != null) outputVariables.put(KEY_RESPONSE_ID, responseId);
        if (userId != null) {
            outputVariables.put(KEY_USER_ID, userId);
            context.setUserId(userId);
            if (session != null) session.setUserId(userId);
        }
        if (result != null) outputVariables.put(KEY_RESULT, result);
    }

    public String flowName(String flowId) {
        if (flowId == null) return null;
        try {
            return flowRepository.findById(flowId).map(f -> f.getName()).orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    /** WhatsApp profile name from the number's latest inbound message, or null. */
    public String senderName(String instituteId, String phone) {
        if (instituteId == null || phone == null) return null;
        try {
            List<String> names = notificationLogRepository.findLatestWhatsAppSenderName(instituteId, phone);
            return names == null || names.isEmpty() ? null : names.get(0);
        } catch (Exception e) {
            log.debug("Sender name lookup failed for {}: {}", phone, e.getMessage());
            return null;
        }
    }

    // ==================== Sending ====================

    /** Send a session text message; records the provider id and the text for the Inbox row. */
    public void sendText(FlowExecutionContext context, String text) {
        ChatbotMessageProvider provider = provider(context);
        context.setLastProviderMessageId(provider.sendText(context.getPhoneNumber(), text,
                context.getInstituteId(), context.getBusinessChannelId()));
        context.setLastSentBody(text);
    }

    /** Send a buttons/list message; {@code inboxText} is what the Inbox row shows for it. */
    public void sendInteractive(FlowExecutionContext context, Map<String, Object> payload, String inboxText) {
        ChatbotMessageProvider provider = provider(context);
        context.setLastProviderMessageId(provider.sendInteractive(context.getPhoneNumber(), payload,
                context.getInstituteId(), context.getBusinessChannelId()));
        context.setLastSentBody(inboxText);
    }

    private ChatbotMessageProvider provider(FlowExecutionContext context) {
        return messageProviders.stream()
                .filter(p -> p.supports(context.getChannelType()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("No provider for channel: " + context.getChannelType()));
    }

    // ==================== Team alert ====================

    /** Hand the conversation to the team (Inbox hand-over list + the flow's alert recipients). Never throws. */
    public void raiseEscalation(ChatbotFlowNode node, ChatbotFlowSession session, FlowExecutionContext context,
                                EscalationReason reason, String userMessage, String botReply, String error) {
        try {
            escalationService.raise(ChatbotEscalationService.EscalationRequest.builder()
                    .instituteId(context.getInstituteId())
                    .flowId(session != null ? session.getFlowId() : null)
                    .sessionId(session != null ? session.getId() : null)
                    .nodeId(node != null ? node.getId() : null)
                    .userPhone(context.getPhoneNumber())
                    .userId(context.getUserId())
                    .userName(senderName(context.getInstituteId(), context.getPhoneNumber()))
                    .channelType(context.getChannelType())
                    .businessChannelId(context.getBusinessChannelId())
                    .reason(reason)
                    .userMessage(userMessage)
                    .botReply(botReply)
                    .errorMessage(error)
                    .build());
        } catch (Exception e) {
            log.warn("CRM node: escalation {} failed for {}: {}", reason, context.getPhoneNumber(), e.getMessage());
        }
    }
}
