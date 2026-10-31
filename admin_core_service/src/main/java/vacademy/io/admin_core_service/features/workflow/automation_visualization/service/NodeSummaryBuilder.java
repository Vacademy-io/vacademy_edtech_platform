package vacademy.io.admin_core_service.features.workflow.automation_visualization.service;

import lombok.Builder;
import lombok.Data;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.workflow.automation_visualization.dto.AutomationDiagramDTO;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds the title / description / details a diagram node shows, driven by the node's REAL
 * {@code node_type} rather than by guessing at the shape of its config JSON.
 *
 * <p>The original visualization layer inferred node types from structural hints ("has
 * outputDataPoints and no routing" => trigger, "forEach.operation == SEND_EMAIL" => send).
 * Nodes the heuristics missed fell through to a generic fallback, which is why a TRIGGER
 * node rendered with the description "TRIGGER" and a SEND_EMAIL node rendered the same
 * sentence for every workflow, with no details at all. Since the controller already injects
 * {@code _nodeType} from the database column, guessing is unnecessary: this switches on it
 * and reports what the node is actually configured to do.</p>
 */
@Service
public class NodeSummaryBuilder {

    /** Config keys that are plumbing, never worth showing to an admin. */
    private static final List<String> INTERNAL_KEYS = List.of(
            "_nodeType", "_nodeName", "_templateParams", "routing", "outputDataPoints");

    /** What the workflow's trigger/schedule rows say — the TRIGGER node's config does not carry it. */
    @Data
    @Builder
    public static class TriggerSummary {
        private String workflowType;      // EVENT_DRIVEN | SCHEDULED
        private String eventName;         // e.g. AUDIENCE_LEAD_SUBMISSION
        private String eventAppliedType;  // e.g. AUDIENCE
        private List<String> scopeLabels; // resolved entity names; empty = fires for everything
        private String cronExpression;
        private String timezone;
    }

    public AutomationDiagramDTO.Node build(String nodeId, String nodeType, String nodeName,
                                           Map<String, Object> config, TriggerSummary trigger) {
        String type = nodeType == null ? "" : nodeType.toUpperCase();
        Map<String, Object> details = new LinkedHashMap<>();
        String description;

        switch (type) {
            case "TRIGGER" -> {
                description = describeTrigger(trigger, details, config);
            }
            case "SEND_EMAIL" -> {
                description = "Sends an email for each recipient produced by the previous step.";
                putIfPresent(details, "Email template", config.get("templateName"));
                putIfPresent(details, "Sent to", readable(config.get("on")));
                putIfPresent(details, "Subject", config.get("subject"));
                putMapIfPresent(details, "Personalisation", config.get("templateVars"));
            }
            case "SEND_WHATSAPP" -> {
                description = "Sends a WhatsApp template message for each recipient produced by the previous step.";
                putIfPresent(details, "WhatsApp template", config.get("templateName"));
                putIfPresent(details, "Sent to", readable(config.get("on")));
                putIfPresent(details, "Phone taken from", readable(config.get("recipientField")));
                putIfPresent(details, "Language", config.get("languageCode"));
                putMapIfPresent(details, "Message parameters", config.get("templateVars"));
            }
            case "SEND_PUSH_NOTIFICATION" -> {
                description = "Sends a push notification. Note: this node type is not wired to a live sender.";
                putIfPresent(details, "Title", config.get("title"));
                putIfPresent(details, "Body", config.get("body"));
            }
            case "QUERY" -> {
                String key = asString(config.get("prebuiltKey"));
                description = "Looks up data and makes it available to the steps that follow.";
                putIfPresent(details, "Query", AutomationParserService.TERMINOLOGY_MAP
                        .getOrDefault(key, AutomationParserService.humanizeIdentifier(key)));
                putMapIfPresent(details, "Parameters", config.get("params"));
            }
            case "DELAY" -> {
                description = "Pauses the workflow before continuing.";
                Object delay = config.get("delay");
                if (delay instanceof Map<?, ?> d) {
                    Object until = d.get("until");
                    if (until != null) {
                        details.put("Waits until", "next " + readable(d.get("dayOfWeek"))
                                + " at " + (d.get("time") != null ? d.get("time") : "09:00")
                                + " (" + (d.get("timezone") != null ? d.get("timezone") : "Asia/Kolkata") + ")");
                    } else {
                        details.put("Waits for", String.valueOf(d.get("value")) + " " + readable(d.get("unit")));
                    }
                } else {
                    putMapIfPresent(details, "Delay", delay);
                }
            }
            case "CONDITION" -> {
                description = "Continues down one branch or the other depending on this check.";
                putIfPresent(details, "Condition", readable(config.get("condition")));
                addRoutingConditions(details, config);
            }
            case "FILTER" -> {
                description = "Keeps only the records that match, and drops the rest.";
                putIfPresent(details, "Applied to", readable(config.get("on")));
                putIfPresent(details, "Keeps records where", readable(config.get("condition")));
            }
            case "HTTP_REQUEST" -> {
                description = "Calls an external service.";
                putIfPresent(details, "Method", config.getOrDefault("method", "GET"));
                putIfPresent(details, "URL", readable(config.get("url")));
            }
            case "SET_LEAD_STATUS" -> {
                description = "Moves the lead to a different status.";
                putIfPresent(details, "New status", config.get("statusKey"));
            }
            case "SCHEDULE_TASK" -> {
                description = "Schedules follow-up work to run later.";
                putMapIfPresent(details, "Task", config);
            }
            default -> {
                description = AutomationParserService.humanizeIdentifier(type);
                putMapIfPresent(details, "Configuration", config);
            }
        }

        return AutomationDiagramDTO.Node.builder()
                .id(nodeId)
                .title(nodeName != null && !nodeName.isBlank()
                        ? nodeName
                        : AutomationParserService.humanizeIdentifier(type))
                .description(description)
                .type(AutomationParserService.mapNodeTypeToDiagramType(type))
                .details(details.isEmpty() ? null : details)
                .build();
    }

    private String describeTrigger(TriggerSummary trigger, Map<String, Object> details,
                                   Map<String, Object> config) {
        if (trigger != null && "SCHEDULED".equalsIgnoreCase(trigger.getWorkflowType())) {
            details.put("Runs on a schedule", trigger.getCronExpression() != null
                    ? trigger.getCronExpression() : "not configured");
            putIfPresent(details, "Timezone", trigger.getTimezone());
            return "This workflow runs on a schedule.";
        }

        // Prefer the trigger row (authoritative — it is what the engine matches on), and fall
        // back to the node's own config for workflows saved before triggers were persisted.
        String eventName = trigger != null && trigger.getEventName() != null
                ? trigger.getEventName()
                : asString(config.get("triggerEvent"));
        details.put("Fires on", AutomationParserService.humanizeIdentifier(eventName));

        if (trigger != null && trigger.getEventAppliedType() != null) {
            details.put("Applies to",
                    AutomationParserService.humanizeIdentifier(trigger.getEventAppliedType()));
        }

        List<String> scope = trigger != null && trigger.getScopeLabels() != null
                ? trigger.getScopeLabels() : List.of();
        if (scope.isEmpty()) {
            // Empty is the deliberate "everything" choice, not missing configuration.
            details.put("Scope", trigger != null && trigger.getEventAppliedType() != null
                    ? "Every " + AutomationParserService.humanizeIdentifier(trigger.getEventAppliedType())
                            .toLowerCase() + " in this institute"
                    : "The whole institute");
        } else {
            details.put(scope.size() == 1 ? "Scope" : "Scope (" + scope.size() + ")",
                    new ArrayList<>(scope));
        }
        return "The workflow starts here when this event happens.";
    }

    /** CONDITION nodes carry the SpEL the engine evaluates inside their routing entries. */
    @SuppressWarnings("unchecked")
    private void addRoutingConditions(Map<String, Object> details, Map<String, Object> config) {
        Object routing = config.get("routing");
        if (!(routing instanceof List<?> entries)) {
            return;
        }
        for (Object entry : entries) {
            if (entry instanceof Map<?, ?> r && r.get("condition") != null) {
                Object rawType = r.get("type");
                String branch = rawType != null ? String.valueOf(rawType) : "branch";
                details.putIfAbsent("If (" + AutomationParserService.humanizeIdentifier(branch) + ")",
                        readable(r.get("condition")));
            }
        }
    }

    private static void putIfPresent(Map<String, Object> details, String label, Object value) {
        String s = asString(value);
        if (s != null && !s.isBlank()) {
            details.put(label, s);
        }
    }

    @SuppressWarnings("unchecked")
    private static void putMapIfPresent(Map<String, Object> details, String label, Object value) {
        if (!(value instanceof Map<?, ?> map) || map.isEmpty()) {
            return;
        }
        Map<String, Object> cleaned = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : map.entrySet()) {
            String key = String.valueOf(e.getKey());
            if (INTERNAL_KEYS.contains(key)) {
                continue;
            }
            cleaned.put(AutomationParserService.humanizeIdentifier(key),
                    AutomationParserService.cleanValue(e.getValue()));
        }
        if (!cleaned.isEmpty()) {
            details.put(label, cleaned);
        }
    }

    /** Strip SpEL scaffolding so "#ctx['user']" reads as "user". */
    private static String readable(Object value) {
        String s = asString(value);
        return s == null ? null : AutomationParserService.cleanSpel(s).replaceAll("^\\{|\\}$", "");
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
