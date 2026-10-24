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

/**
 * CRM_LEAD_CHECK — is this WhatsApp number already a lead in the institute?
 *
 * <ul>
 *   <li><b>EXISTING</b>: admin-core records the repeat contact on that lead (no new entry). The
 *       node optionally sends {@code existingMessage} and alerts the team, then follows the
 *       "EXISTING" edge — the new-lead questions are never asked again.</li>
 *   <li><b>NEW</b>: admin-core has just created the lead in the "WhatsApp Leads" list, so even
 *       someone who stops halfway is in the CRM. Follows the "NEW" edge.</li>
 * </ul>
 * If admin-core cannot be reached the flow still continues down "NEW" (lead_result=UNKNOWN):
 * the questions get asked and SAVE_TO_CRM resolves or creates the lead at the end.
 *
 * <p>Config: {@code { "existingMessage": "Welcome back! …", "notifyTeam": true }}
 * <br>Edges: conditionConfig {@code {"branchId":"NEW"}} and {@code {"branchId":"EXISTING"}}.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class CrmLeadCheckNodeExecutor implements ChatbotNodeExecutor {

    public static final String BRANCH_NEW = "NEW";
    public static final String BRANCH_EXISTING = "EXISTING";

    private final CrmLeadNodeSupport support;
    private final WhatsAppFlowLeadClient leadClient;

    @Override
    public boolean canHandle(String nodeType) {
        return ChatbotNodeType.CRM_LEAD_CHECK.name().equals(nodeType);
    }

    @Override
    public NodeExecutionResult execute(ChatbotFlowNode node, ChatbotFlowSession session,
                                       String userText, FlowExecutionContext context) {
        Map<String, Object> config = support.parseConfig(node.getConfig());
        Map<String, Object> output = new HashMap<>();
        String branch = BRANCH_NEW;

        try {
            Map<String, Object> request = support.baseRequest(session, context);
            request.put("messageText", context.getMessageText());
            Map<String, Object> response = leadClient.check(request);
            support.applyLead(response, session, context, output);
            if (CrmLeadNodeSupport.RESULT_EXISTING.equals(CrmLeadNodeSupport.str(response, "result"))) {
                branch = BRANCH_EXISTING;
            }
        } catch (Exception e) {
            log.warn("CRM_LEAD_CHECK: lead lookup failed for phone={} institute={} — continuing as a new enquiry: {}",
                    context.getPhoneNumber(), context.getInstituteId(), e.getMessage());
            output.put(CrmLeadNodeSupport.KEY_RESULT, CrmLeadNodeSupport.RESULT_UNKNOWN);
        }

        if (BRANCH_EXISTING.equals(branch)) {
            String message = CrmLeadNodeSupport.str(config, "existingMessage");
            String sent = null;
            if (message != null && !message.isBlank()) {
                try {
                    support.sendText(context, message.trim());
                    sent = message.trim();
                } catch (Exception e) {
                    // The lead check itself succeeded — a failed courtesy message must not stop the flow.
                    context.setLastSentBody(null);
                    log.warn("CRM_LEAD_CHECK: existing-lead message not sent to {}: {}",
                            context.getPhoneNumber(), e.getMessage());
                }
            }
            if (!Boolean.FALSE.equals(config.get("notifyTeam"))) {
                support.raiseEscalation(node, session, context, EscalationReason.EXISTING_LEAD,
                        context.getMessageText(), sent, null);
            }
        }

        return NodeExecutionResult.builder()
                .success(true)
                .selectedBranchId(branch)
                .strictBranch(true)
                .outputVariables(output)
                .build();
    }
}
