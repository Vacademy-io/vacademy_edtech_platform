package vacademy.io.admin_core_service.features.workflow.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowExecutionLogger;

import vacademy.io.admin_core_service.features.workflow.enums.ExecutionLogStatus;
import vacademy.io.admin_core_service.features.workflow.enums.NodeType;
import vacademy.io.admin_core_service.features.workflow.dto.execution_log.TransformExecutionDetails;
import vacademy.io.common.logging.SentryLogger;

import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class TransformNodeHandler implements NodeHandler {
    private final ObjectMapper objectMapper;
    private final SpelEvaluator spelEvaluator;
    private final WorkflowExecutionLogger executionLogger;

    @Override
    public boolean supports(String nodeType) {
        return "TRANSFORM".equalsIgnoreCase(nodeType);
    }

    @Override
    public Map<String, Object> handle(Map<String, Object> context, String nodeConfigJson,
            Map<String, NodeTemplate> nodeTemplates, int countProcessed) {
        // Keys only: the context can carry a person's contact details or a link meant for them.
        log.info("TransformNodeHandler.handle() invoked with context keys: {}, configJson: {}", context.keySet(),
                nodeConfigJson);

        String workflowExecutionId = (String) context.get("executionId");
        String nodeId = (String) context.get("currentNodeId");

        // Start logging
        String logId = null;
        long startTime = System.currentTimeMillis();
        if (workflowExecutionId != null && nodeId != null) {
            logId = executionLogger.startNodeExecution(workflowExecutionId, nodeId, NodeType.TRANSFORM, context);
        }

        // Create a mutable copy of the context to apply chained transformations
        Map<String, Object> localContext = new HashMap<>(context);
        List<String> transformedFields = new ArrayList<>();

        try {
            JsonNode config = objectMapper.readTree(nodeConfigJson);

            // Process output data points with compute expressions
            JsonNode outputs = config.path("outputDataPoints");
            if (outputs.isArray()) {
                for (JsonNode output : outputs) {
                    String fieldName = output.path("fieldName").asText(null);
                    String computeExpr = output.path("compute").asText(null);

                    if (fieldName == null || fieldName.isBlank()) {
                        log.warn("Skipping output data point with missing fieldName.");
                        continue;
                    }

                    if (computeExpr != null && !computeExpr.isBlank()) {
                        // Evaluate compute expression against the *current* state of the local context
                        Object value = spelEvaluator.evaluate(computeExpr, localContext);

                        // Update the local context with the new value for the next iteration
                        localContext.put(fieldName, value);
                        transformedFields.add(fieldName);
                        log.debug("Field '{}' transformed via SpEL. New value has been updated in the local context.",
                                fieldName);
                    }
                }
            }

        } catch (Exception e) {
            log.error("Error while processing TransformNodeHandler config", e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Transform node execution failed")
                    .withTag("workflow.execution.id", workflowExecutionId != null ? workflowExecutionId : "unknown")
                    .withTag("node.id", nodeId != null ? nodeId : "unknown")
                    .withTag("node.type", "TRANSFORM")
                    .withTag("transformed.fields.count", String.valueOf(transformedFields.size()))
                    .withTag("operation", "transformData")
                    .send();
            // Return an error in the context if something goes wrong
            Map<String, Object> errorResult = new HashMap<>();
            errorResult.put("error", "TransformNodeHandler failed: " + e.getMessage());

            // Log failure
            if (logId != null) {
                executionLogger.completeNodeExecution(logId, ExecutionLogStatus.FAILED, null,
                        e.getMessage());
            }
            return errorResult;
        }

        // Calculate the net changes to return to the workflow engine
        Map<String, Object> finalChanges = new HashMap<>();
        for (Map.Entry<String, Object> entry : localContext.entrySet()) {
            // Add to changes if the key is new or the value has changed
            if (!context.containsKey(entry.getKey())
                    || !Objects.equals(context.get(entry.getKey()), entry.getValue())) {
                finalChanges.put(entry.getKey(), entry.getValue());
            }
        }

        log.info("Transform changes map prepared with keys: {}", finalChanges.keySet());

        // Complete logging with success
        if (logId != null) {
            TransformExecutionDetails details = TransformExecutionDetails.builder()
                    .inputContext(executionLogger.sanitizeContext(context))
                    .outputContext(executionLogger.sanitizeContext(finalChanges))
                    .transformedFields(transformedFields)
                    .executionTimeMs(System.currentTimeMillis() - startTime)
                    .build();

            executionLogger.completeNodeExecution(logId, ExecutionLogStatus.SUCCESS, details, null);
        }

        return finalChanges;
    }
}
