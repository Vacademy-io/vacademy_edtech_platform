package vacademy.io.admin_core_service.features.workflow.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.workflow.dto.TriggerNodeDTO;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowExecutionLogger;

import vacademy.io.admin_core_service.features.workflow.enums.ExecutionLogStatus;
import vacademy.io.admin_core_service.features.workflow.enums.NodeType;
import vacademy.io.admin_core_service.features.workflow.dto.execution_log.TriggerNodeExecutionDetails;

import java.util.HashMap;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class TriggerNodeHandler implements NodeHandler {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final SpelEvaluator spelEvaluator;
    private final WorkflowExecutionLogger executionLogger;

    @Override
    public boolean supports(String nodeType) {
        boolean supported = "TRIGGER".equalsIgnoreCase(nodeType);
        log.debug("TriggerNodeHandler.supports(nodeType={}) -> {}", nodeType, supported);
        return supported;
    }

    @Override
    public Map<String, Object> handle(Map<String, Object> context, String nodeConfigJson,
            Map<String, NodeTemplate> nodeTemplates, int countProcessed) {
        // Keys only: the context can carry a person's contact details or a link meant for them.
        log.info("TriggerNodeHandler.handle() invoked with context keys: {}, configJson: {}", context.keySet(),
                nodeConfigJson);

        String workflowExecutionId = (String) context.get("executionId");
        String nodeId = (String) context.get("currentNodeId");

        // Start logging if execution ID is present
        // Start logging if execution ID is present
        String logId = null;
        long startTime = System.currentTimeMillis();
        if (workflowExecutionId != null && nodeId != null) {
            logId = executionLogger.startNodeExecution(workflowExecutionId, nodeId, NodeType.TRIGGER, context);
        }

        Map<String, Object> changes = new HashMap<>();
        int dataPointsCount = 0;

        try {
            TriggerNodeDTO config = objectMapper.readValue(nodeConfigJson, TriggerNodeDTO.class);

            if (config.getOutputDataPoints() != null) {
                for (TriggerNodeDTO.OutputDataPoint output : config.getOutputDataPoints()) {
                    String fieldName = output.getFieldName();
                    if (fieldName == null || fieldName.isBlank())
                        continue;

                    if (output.getCompute() != null && !output.getCompute().isBlank()) {
                        Object value = spelEvaluator.evaluate(output.getCompute(), context);
                        changes.put(fieldName, value);
                        log.debug("Field '{}' computed via SpEL", fieldName);
                        dataPointsCount++;
                    } else if (output.getValue() != null) {
                        changes.put(fieldName, output.getValue());
                        log.debug("Field '{}' set to a static value", fieldName);
                        dataPointsCount++;
                    }
                }
            }

            // Complete logging with success
            if (logId != null) {
                TriggerNodeExecutionDetails details = TriggerNodeExecutionDetails.builder()
                        .inputContext(executionLogger.sanitizeContext(context))
                        .outputContext(executionLogger.sanitizeContext(changes))
                        .dataPoints(dataPointsCount)
                        .executionTimeMs(System.currentTimeMillis() - startTime)
                        .build();

                executionLogger.completeNodeExecution(logId, ExecutionLogStatus.SUCCESS, details, null);
            }

        } catch (Exception e) {
            log.error("Error while processing TriggerNodeHandler config", e);

            // Log failure
            if (logId != null) {
                executionLogger.completeNodeExecution(logId, ExecutionLogStatus.FAILED, null,
                        e.getMessage());
            }
            throw new RuntimeException("Trigger node execution failed", e);
        }

        log.info("Changes map prepared with keys: {}", changes.keySet());
        return changes;
    }
}
