package vacademy.io.admin_core_service.features.workflow.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.workflow.dto.QueryNodeDTO;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowExecutionLogger;
import vacademy.io.admin_core_service.features.workflow.enums.ExecutionLogStatus;
import vacademy.io.admin_core_service.features.workflow.enums.NodeType;
import vacademy.io.admin_core_service.features.workflow.dto.execution_log.QueryExecutionDetails;
import vacademy.io.common.logging.SentryLogger;

import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class QueryNodeHandler implements NodeHandler {
    private final ObjectMapper objectMapper;
    private final SpelEvaluator spelEvaluator;
    private final QueryService queryService;
    private final WorkflowExecutionLogger executionLogger;

    @Override
    public boolean supports(String nodeType) {
        return "QUERY".equalsIgnoreCase(nodeType);
    }

    @Override
    public Map<String, Object> handle(Map<String, Object> context,
            String nodeConfigJson,
            Map<String, NodeTemplate> nodeTemplates,
            int countProcessed) {
        // Keys only: the context can carry a person's contact details or a link meant for them.
        log.info("QueryNodeHandler.handle() invoked with context keys: {}, configJson: {}", context.keySet(),
                nodeConfigJson);

        String workflowExecutionId = (String) context.get("executionId");
        String nodeId = (String) context.get("currentNodeId");

        // Start logging
        String logId = null;
        long startTime = System.currentTimeMillis();
        if (workflowExecutionId != null && nodeId != null) {
            logId = executionLogger.startNodeExecution(workflowExecutionId, nodeId, NodeType.QUERY, context);
        }

        Map<String, Object> changes = new HashMap<>();
        String prebuiltKey = null;
        int rowsReturned = 0;

        try {
            // Deserialize JSON into DTO
            QueryNodeDTO config = objectMapper.readValue(nodeConfigJson, QueryNodeDTO.class);

            prebuiltKey = config.getPrebuiltKey();
            Map<String, Object> rawParams = config.getParams();

            if (prebuiltKey != null && !prebuiltKey.isBlank()) {
                Map<String, Object> queryParams = new HashMap<>();

                if (rawParams != null) {
                    for (Map.Entry<String, Object> entry : rawParams.entrySet()) {
                        String key = entry.getKey();
                        Object valueExpr = entry.getValue();

                        Object value;
                        if (valueExpr instanceof String) {
                            String strVal = (String) valueExpr;
                            // Only evaluate as SpEL if it starts with # (e.g., #ctx['instituteId'])
                            // Plain values like UUIDs, numbers, status strings are used as-is
                            if (strVal.startsWith("#")) {
                                value = spelEvaluator.evaluate(strVal, context);
                            } else {
                                value = strVal;
                            }
                        } else {
                            value = valueExpr;
                        }
                        queryParams.put(key, value);
                    }
                }

                // Auto-inject instituteId from workflow context if not explicitly provided
                if (!queryParams.containsKey("instituteId") && context.containsKey("instituteId")) {
                    queryParams.put("instituteId", context.get("instituteId"));
                }

                // Test Run safety: never execute a WRITE query in dry-run mode. Read
                // queries still run (a dry run should show real audience/roster data);
                // only mutations are skipped, with the intent logged.
                boolean dryRun = Boolean.TRUE.equals(context.get("dryRun"));
                if (dryRun && MutatingQueryKeys.isMutating(prebuiltKey)) {
                    log.info("[DRY RUN] Skipping mutating query '{}' (param keys: {})", prebuiltKey,
                            queryParams.keySet());
                    changes.put("dryRun", true);
                    changes.put("skippedMutatingQuery", prebuiltKey);
                } else {
                    log.debug("Executing query with key: {}, param keys: {}", prebuiltKey, queryParams.keySet());
                    Map<String, Object> queryResult = queryService.execute(prebuiltKey, queryParams);
                    if (queryResult != null) {
                        changes.putAll(queryResult);
                        rowsReturned = queryResult.size(); // Approximation
                    }
                }
            }

            // Complete logging with success
            if (logId != null) {
                QueryExecutionDetails details = QueryExecutionDetails.builder()
                        .inputContext(executionLogger.sanitizeContext(context))
                        .outputContext(executionLogger.sanitizeContext(changes))
                        .query(prebuiltKey)
                        .rowsReturned(rowsReturned)
                        .executionTimeMs(System.currentTimeMillis() - startTime)
                        .build();

                executionLogger.completeNodeExecution(logId, ExecutionLogStatus.SUCCESS, details, null);
            }

        } catch (Exception e) {
            log.error("Error while processing QueryNodeHandler config", e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Query node execution failed")
                    .withTag("workflow.execution.id", workflowExecutionId != null ? workflowExecutionId : "unknown")
                    .withTag("node.id", nodeId != null ? nodeId : "unknown")
                    .withTag("node.type", "QUERY")
                    .withTag("query.key", prebuiltKey != null ? prebuiltKey : "unknown")
                    .withTag("operation", "executeQuery")
                    .send();
            changes.put("error", e.getMessage());

            // Log failure
            if (logId != null) {
                executionLogger.completeNodeExecution(logId, ExecutionLogStatus.FAILED, null,
                        e.getMessage());
            }
            // We don't throw exception here to allow workflow to continue if error handling
            // is configured
            // But for logging purposes, we marked it as FAILED.
        }

        log.info("Query changes map prepared with keys: {}", changes.keySet());
        return changes;
    }

    public interface QueryService {
        Map<String, Object> execute(String prebuiltKey, Map<String, Object> params);
    }
}