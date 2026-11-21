package vacademy.io.notification_service.features.chatbot_flow.engine.executors;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.NodeExecutionResult;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.enums.ChatbotNodeType;
import vacademy.io.notification_service.features.chatbot_flow.enums.EscalationReason;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppFlowLeadClient;

import java.util.HashMap;
import java.util.Map;
import java.util.StringJoiner;

/**
 * SAVE_TO_CRM — the flow has finished collecting: send every answer in the session to the lead
 * (creating/resolving it if the earlier CRM_LEAD_CHECK could not), set the configured lead status
 * and fire the lead-submission workflows (new leads only — admin-core enforces that).
 *
 * <p>If admin-core cannot be reached the answers are not lost silently: the team is alerted
 * (CRM_SAVE_FAILED) with the collected answers in the alert, and they stay in the session.
 *
 * <p>Config: {@code { "statusKey": "NEW" | null, "successMessage": "Thanks! …", "fireWorkflows": true }}
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class SaveToCrmNodeExecutor implements ChatbotNodeExecutor {

    private final CrmLeadNodeSupport support;
    private final WhatsAppFlowLeadClient leadClient;

    @Override
    public boolean canHandle(String nodeType) {
        return ChatbotNodeType.SAVE_TO_CRM.name().equals(nodeType);
    }

    @Override
    public NodeExecutionResult execute(ChatbotFlowNode node, ChatbotFlowSession session,
                                       String userText, FlowExecutionContext context) {
        Map<String, Object> config = support.parseConfig(node.getConfig());
        Map<String, Object> sessionCtx = support.sessionContext(session);
        Map<String, String> fields = CrmLeadNodeSupport.stringMap(sessionCtx, CrmLeadNodeSupport.KEY_FIELDS);
        Map<String, String> system = CrmLeadNodeSupport.stringMap(sessionCtx, CrmLeadNodeSupport.KEY_SYSTEM);
        Map<String, Object> output = new HashMap<>();

        try {
            Map<String, Object> request = support.baseRequest(session, context);
            request.put("responseId", CrmLeadNodeSupport.str(sessionCtx, CrmLeadNodeSupport.KEY_RESPONSE_ID));
            request.put("overwrite", CrmLeadNodeSupport.RESULT_NEW.equals(
                    CrmLeadNodeSupport.str(sessionCtx, CrmLeadNodeSupport.KEY_RESULT)));
            request.put("fieldValues", fields);
            request.put("fullName", system.get("full_name"));
            request.put("email", system.get("email"));
            request.put("statusKey", CrmLeadNodeSupport.str(config, "statusKey"));
            request.put("complete", true);
            // Default on: a new lead from WhatsApp runs the same lead-submitted workflows as any other
            // source. Admins turn it off when those workflows would send a second welcome message.
            request.put("fireWorkflow", !Boolean.FALSE.equals(config.get("fireWorkflows")));
            request.put("messageText", context.getMessageText());
            Map<String, Object> response = leadClient.save(request);
            support.applyLead(response, session, context, output);
        } catch (Exception e) {
            log.error("SAVE_TO_CRM: answers not saved for phone={} institute={}: {}",
                    context.getPhoneNumber(), context.getInstituteId(), e.getMessage());
            support.raiseEscalation(node, session, context, EscalationReason.CRM_SAVE_FAILED,
                    answerSummary(fields, system, CrmLeadNodeSupport.stringMap(sessionCtx,
                            CrmLeadNodeSupport.KEY_FIELD_LABELS)),
                    null, e.getMessage());
        }

        String message = CrmLeadNodeSupport.str(config, "successMessage");
        if (message != null && !message.isBlank()) {
            try {
                support.sendText(context, message.trim());
            } catch (Exception e) {
                context.setLastSentBody(null);
                log.warn("SAVE_TO_CRM: success message not sent to {}: {}", context.getPhoneNumber(), e.getMessage());
            }
        }
        return NodeExecutionResult.builder().success(true).outputVariables(output).build();
    }

    /** "Year Group: Year 5 · Name: Asha" — what the team needs to enter the lead by hand. */
    static String answerSummary(Map<String, String> fields, Map<String, String> system, Map<String, String> labels) {
        StringJoiner joiner = new StringJoiner(" · ");
        if (system.get("full_name") != null) joiner.add("Name: " + system.get("full_name"));
        if (system.get("email") != null) joiner.add("Email: " + system.get("email"));
        fields.forEach((id, value) -> joiner.add(labels.getOrDefault(id, id) + ": " + value));
        String summary = joiner.toString();
        return summary.isEmpty() ? "No answers were collected." : "Collected answers — " + summary;
    }
}
