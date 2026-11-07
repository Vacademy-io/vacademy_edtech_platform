package vacademy.io.admin_core_service.features.workflow.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.workflow.dto.ContextSchemaRequestDTO;
import vacademy.io.admin_core_service.features.workflow.dto.ContextVariableDTO;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class WorkflowContextSchemaService {

    /**
     * Given a list of upstream nodes, compute what context variables are available.
     */
    public List<ContextVariableDTO> getAvailableVariables(ContextSchemaRequestDTO request) {
        List<ContextVariableDTO> variables = new ArrayList<>();

        // Always-available global variables
        variables.add(ContextVariableDTO.builder()
                .key("executionId").type("String").sourceNodeId("system").sourceNodeName("System")
                .sourceNodeType("SYSTEM").description("Current workflow execution ID")
                .spelExpression("#ctx['executionId']").build());
        variables.add(ContextVariableDTO.builder()
                .key("workflowId").type("String").sourceNodeId("system").sourceNodeName("System")
                .sourceNodeType("SYSTEM").description("Current workflow ID")
                .spelExpression("#ctx['workflowId']").build());
        variables.add(ContextVariableDTO.builder()
                .key("instituteId").type("String").sourceNodeId("system").sourceNodeName("System")
                .sourceNodeType("SYSTEM").description("Institute ID from context")
                .spelExpression("#ctx['instituteId']").build());

        if (request.getUpstreamNodes() == null) return variables;

        for (ContextSchemaRequestDTO.UpstreamNode node : request.getUpstreamNodes()) {
            List<ContextVariableDTO> nodeVars = getOutputVariablesForNodeType(
                    node.getNodeId(), node.getNodeName(), node.getNodeType(), node.getConfig());
            variables.addAll(nodeVars);
        }

        return variables;
    }

    private List<ContextVariableDTO> getOutputVariablesForNodeType(
            String nodeId, String nodeName, String nodeType, Map<String, Object> config) {
        List<ContextVariableDTO> vars = new ArrayList<>();
        String type = nodeType != null ? nodeType.toUpperCase() : "";

        switch (type) {
            case "TRIGGER" -> {
                vars.add(var(nodeId, nodeName, nodeType, "triggerData", "Map<String, Object>",
                        "Data from the trigger event", "#ctx['triggerData']"));
                vars.add(var(nodeId, nodeName, nodeType, "triggerEventName", "String",
                        "Name of the trigger event", "#ctx['triggerEventName']"));
            }
            case "QUERY" -> {
                // The QUERY node copies the query's own result keys onto the context and never
                // writes its resultKey, so offer only the keys the chosen query really puts
                // there. Offering resultKey / 'queryResult' handed admins a list that is always
                // empty: a send node reading it sent nothing, with no error.
                Object prebuiltKey = config != null ? config.get("prebuiltKey") : null;
                List<String> outputs = PrebuiltQueryOutputs
                        .keysOf(prebuiltKey instanceof String k ? k : null)
                        .orElse(List.of());
                for (int i = 0; i < outputs.size(); i++) {
                    String key = outputs.get(i);
                    vars.add(var(nodeId, nodeName, nodeType, key, i == 0 ? "List<Map>" : "Object",
                            i == 0 ? "Query result rows" : "Query output", "#ctx['" + key + "']"));
                }
            }
            case "TRANSFORM" -> {
                vars.add(var(nodeId, nodeName, nodeType, "transformedData", "Map<String, Object>",
                        "Transformed data fields", "#ctx['transformedData']"));
            }
            case "HTTP_REQUEST" -> {
                String resultKey = config != null ? (String) config.getOrDefault("resultKey", "httpResponse") : "httpResponse";
                vars.add(var(nodeId, nodeName, nodeType, resultKey, "Object",
                        "HTTP response body", "#ctx['" + resultKey + "']"));
                vars.add(var(nodeId, nodeName, nodeType, "httpStatusCode", "Number",
                        "HTTP response status code", "#ctx['httpStatusCode']"));
            }
            case "FILTER" -> {
                String outputKey = config != null ? (String) config.getOrDefault("outputKey", "filteredList") : "filteredList";
                vars.add(var(nodeId, nodeName, nodeType, outputKey, "List<Object>",
                        "Filtered list of items", "#ctx['" + outputKey + "']"));
                vars.add(var(nodeId, nodeName, nodeType, "filteredCount", "Number",
                        "Number of items that passed filter", "#ctx['filteredCount']"));
                vars.add(var(nodeId, nodeName, nodeType, "totalCount", "Number",
                        "Total items before filtering", "#ctx['totalCount']"));
            }
            case "AGGREGATE" -> {
                vars.add(var(nodeId, nodeName, nodeType, "aggregateResults", "Map<String, Number>",
                        "Aggregation results (COUNT, SUM, AVG, etc.)", "#ctx['aggregateResults']"));
            }
            case "CONDITION" -> {
                vars.add(var(nodeId, nodeName, nodeType, "conditionResult", "Boolean",
                        "Result of condition evaluation (true/false)", "#ctx['conditionResult']"));
            }
            case "LOOP" -> {
                String itemVar = config != null ? (String) config.getOrDefault("itemVariable", "item") : "item";
                String outputKey = config != null ? (String) config.getOrDefault("outputKey", "loopResults") : "loopResults";
                vars.add(var(nodeId, nodeName, nodeType, itemVar, "Object",
                        "Current iteration item", "#ctx['" + itemVar + "']"));
                vars.add(var(nodeId, nodeName, nodeType, "loopIndex", "Number",
                        "Current iteration index (0-based)", "#ctx['loopIndex']"));
                vars.add(var(nodeId, nodeName, nodeType, "loopSize", "Number",
                        "Total number of items in loop", "#ctx['loopSize']"));
                vars.add(var(nodeId, nodeName, nodeType, outputKey, "List<Object>",
                        "Collected loop results", "#ctx['" + outputKey + "']"));
            }
            case "DELAY" -> {
                vars.add(var(nodeId, nodeName, nodeType, "delayed", "Boolean",
                        "Whether delay was actually applied", "#ctx['delayed']"));
            }
            case "SEND_EMAIL" -> {
                vars.add(var(nodeId, nodeName, nodeType, "emailStatus", "String",
                        "Email sending status", "#ctx['status']"));
                vars.add(var(nodeId, nodeName, nodeType, "processed_count", "Number",
                        "Number of emails processed", "#ctx['processed_count']"));
            }
            case "SEND_WHATSAPP" -> {
                vars.add(var(nodeId, nodeName, nodeType, "whatsappStatus", "String",
                        "WhatsApp sending status", "#ctx['status']"));
                vars.add(var(nodeId, nodeName, nodeType, "processed_count", "Number",
                        "Number of messages processed", "#ctx['processed_count']"));
            }
            case "SCHEDULE_TASK" -> {
                vars.add(var(nodeId, nodeName, nodeType, "scheduleId", "String",
                        "ID of the created schedule", "#ctx['scheduleId']"));
                vars.add(var(nodeId, nodeName, nodeType, "scheduledAt", "String",
                        "When the task is scheduled for", "#ctx['scheduledAt']"));
            }
            case "UPDATE_RECORD" -> {
                vars.add(var(nodeId, nodeName, nodeType, "rowsUpdated", "Number",
                        "Number of database rows updated", "#ctx['rowsUpdated']"));
            }
            case "MERGE" -> {
                vars.add(var(nodeId, nodeName, nodeType, "merged", "Boolean",
                        "Whether all upstream paths have completed", "#ctx['merged']"));
            }
            case "SEND_PUSH_NOTIFICATION" -> {
                vars.add(var(nodeId, nodeName, nodeType, "recipientCount", "Number",
                        "Number of push notification recipients", "#ctx['recipientCount']"));
                vars.add(var(nodeId, nodeName, nodeType, "pushStatus", "String",
                        "Push notification dispatch status", "#ctx['status']"));
            }
            default -> {
                // Generic: action nodes and unknown types
                vars.add(var(nodeId, nodeName, nodeType, nodeId + "_output", "Object",
                        "Output from " + nodeName, "#ctx['" + nodeId + "_output']"));
            }
        }

        return vars;
    }

    private ContextVariableDTO var(String nodeId, String nodeName, String nodeType,
                                    String key, String varType, String description, String spelExpr) {
        return ContextVariableDTO.builder()
                .key(key)
                .type(varType)
                .sourceNodeId(nodeId)
                .sourceNodeName(nodeName != null ? nodeName : nodeId)
                .sourceNodeType(nodeType)
                .description(description)
                .spelExpression(spelExpr)
                .build();
    }
}
