package vacademy.io.admin_core_service.features.workflow.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecutionLog;
import vacademy.io.admin_core_service.features.workflow.enums.ExecutionLogStatus;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionLogRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionRepository;
import vacademy.io.common.logging.SentryLogger;

import java.time.Instant;
import java.util.*;

/**
 * Centralized service for logging workflow node executions.
 * Provides methods to start, update, and complete node execution logs.
 * Uses separate transactions to ensure logs are persisted even if workflow
 * fails.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkflowExecutionLogger {

    private final WorkflowExecutionLogRepository executionLogRepository;
    private final WorkflowExecutionRepository workflowExecutionRepository;
    private final ObjectMapper objectMapper;

    /**
     * Starts logging for a node execution.
     * Creates a log entry with RUNNING status.
     *
     * @param workflowExecutionId The workflow execution ID
     * @param nodeTemplateId      The node template ID
     * @param nodeType            The node type
     * @param inputContext        Input context/data for the node
     * @return The created log ID
     */
    @org.springframework.transaction.annotation.Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public String startNodeExecution(
            String workflowExecutionId,
            String nodeTemplateId,
            String nodeType,
            Map<String, Object> inputContext) {

        try {
            WorkflowExecutionLog logEntity = WorkflowExecutionLog.builder()
                    .workflowExecutionId(workflowExecutionId)
                    .nodeTemplateId(nodeTemplateId)
                    .nodeType(nodeType)
                    .status(ExecutionLogStatus.RUNNING)
                    .startedAt(Instant.now())
                    .build();

            // Store minimal input context to avoid huge JSON
            if (inputContext != null && !inputContext.isEmpty()) {
                try {
                    String inputJson = objectMapper.writeValueAsString(
                            Map.of("inputContext", sanitizeContext(inputContext)));
                    logEntity.setDetailsJson(inputJson);
                } catch (JsonProcessingException e) {
                    log.error("Failed to serialize input context for node: {}", nodeTemplateId, e);
                    SentryLogger.logError(e, "Failed to serialize workflow input context", Map.of(
                            "node.template.id", nodeTemplateId,
                            "node.type", nodeType,
                            "workflow.execution.id", workflowExecutionId,
                            "operation", "startNodeExecution"));
                }
            }

            WorkflowExecutionLog saved = executionLogRepository.save(logEntity);
            log.debug("Started node execution log: {} for node: {}, type: {}",
                    saved.getId(), nodeTemplateId, nodeType);

            return saved.getId();
        } catch (Exception e) {
            log.error("Failed to start node execution log for node: {}, type: {}",
                    nodeTemplateId, nodeType, e);
            SentryLogger.logError(e, "Failed to create node execution log", Map.of(
                    "node.template.id", nodeTemplateId,
                    "node.type", nodeType,
                    "workflow.execution.id", workflowExecutionId,
                    "operation", "startNodeExecution"));
            return null;
        }
    }

    public String startNodeExecution(
            String workflowExecutionId,
            String nodeTemplateId,
            vacademy.io.admin_core_service.features.workflow.enums.NodeType nodeType,
            Map<String, Object> inputContext) {
        return startNodeExecution(workflowExecutionId, nodeTemplateId, nodeType.name(), inputContext);
    }

    /**
     * Completes a node execution log with success status.
     *
     * @param logId         The log ID
     * @param outputContext Output context/data from the node
     * @param detailsObject Detailed execution information (node-specific DTO)
     */

    public void completeNodeExecution(
            String logId,
            Map<String, Object> outputContext,
            Object detailsObject) {

        completeNodeExecutionWithStatus(logId, ExecutionLogStatus.SUCCESS, outputContext, detailsObject, null, null);
    }

    public void completeNodeExecution(
            String logId,
            ExecutionLogStatus status,
            Object detailsObject,
            String errorMessage) {
        completeNodeExecutionWithStatus(logId, status, null, detailsObject, errorMessage, null);
    }

    /**
     * Completes a node execution log with partial success status.
     *
     * @param logId         The log ID
     * @param outputContext Output context/data from the node
     * @param detailsObject Detailed execution information including failures
     */

    public void completeNodeExecutionPartial(
            String logId,
            Map<String, Object> outputContext,
            Object detailsObject) {

        completeNodeExecutionWithStatus(logId, ExecutionLogStatus.PARTIAL_SUCCESS, outputContext, detailsObject, null,
                null);
    }

    /**
     * Marks a node execution as failed.
     *
     * @param logId         The log ID
     * @param errorMessage  Error message
     * @param errorType     Error type/category
     * @param detailsObject Detailed execution information including error context
     */

    public void failNodeExecution(
            String logId,
            String errorMessage,
            String errorType,
            Object detailsObject) {

        completeNodeExecutionWithStatus(logId, ExecutionLogStatus.FAILED, null, detailsObject, errorMessage, errorType);
    }

    /**
     * Marks a node execution as skipped (due to conditional execution).
     *
     * @param logId  The log ID
     * @param reason Reason for skipping
     */

    public void skipNodeExecution(String logId, String reason) {
        try {
            WorkflowExecutionLog logEntity = executionLogRepository.findById(logId).orElse(null);
            if (logEntity == null) {
                log.warn("Cannot skip node execution - log not found: {}", logId);
                return;
            }

            logEntity.markCompleted(ExecutionLogStatus.SKIPPED);

            if (reason != null) {
                try {
                    String detailsJson = objectMapper.writeValueAsString(Map.of("skipReason", reason));
                    logEntity.setDetailsJson(detailsJson);
                } catch (JsonProcessingException e) {
                    log.error("Failed to serialize skip reason", e);
                    SentryLogger.logError(e, "Failed to serialize workflow skip reason", Map.of(
                            "log.id", logId,
                            "operation", "skipNodeExecution"));
                }
            }

            executionLogRepository.save(logEntity);
            log.debug("Marked node execution as skipped: {}, reason: {}", logId, reason);
        } catch (Exception e) {
            log.error("Failed to skip node execution: {}", logId, e);
            SentryLogger.logError(e, "Failed to skip node execution", Map.of(
                    "log.id", logId,
                    "operation", "skipNodeExecution"));
        }
    }

    /**
     * Updates a running node execution with progress information.
     * Useful for long-running operations like large iterations.
     *
     * @param logId        The log ID
     * @param progressInfo Progress information
     */

    public void updateNodeExecutionProgress(String logId, Map<String, Object> progressInfo) {
        try {
            WorkflowExecutionLog logEntity = executionLogRepository.findById(logId).orElse(null);
            if (logEntity == null) {
                log.warn("Cannot update progress - log not found: {}", logId);
                return;
            }

            if (logEntity.getStatus() != ExecutionLogStatus.RUNNING) {
                log.warn("Cannot update progress - node execution not running: {}", logId);
                return;
            }

            try {
                String currentDetails = logEntity.getDetailsJson();
                Map<String, Object> details = currentDetails != null
                        ? objectMapper.readValue(currentDetails, Map.class)
                        : Map.of();

                // Merge progress info
                details.put("progress", progressInfo);
                details.put("lastProgressUpdate", Instant.now().toString());

                logEntity.setDetailsJson(objectMapper.writeValueAsString(details));
                executionLogRepository.save(logEntity);

                log.debug("Updated node execution progress: {}", logId);
            } catch (JsonProcessingException e) {
                log.error("Failed to update progress for log: {}", logId, e);
                SentryLogger.logError(e, "Failed to serialize workflow progress update", Map.of(
                        "log.id", logId,
                        "operation", "updateNodeExecutionProgress"));
            }
        } catch (Exception e) {
            log.error("Failed to update node execution progress: {}", logId, e);
            SentryLogger.logError(e, "Failed to update node execution progress", Map.of(
                    "log.id", logId,
                    "operation", "updateNodeExecutionProgress"));
        }
    }

    /**
     * Internal method to complete node execution with specific status.
     */
    @CacheEvict(value = { "executionLogs", "nodeLogs" }, allEntries = true)
    @org.springframework.transaction.annotation.Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void completeNodeExecutionWithStatus(
            String logId,
            ExecutionLogStatus status,
            Map<String, Object> outputContext,
            Object detailsObject,
            String errorMessage,
            String errorType) {

        try {
            WorkflowExecutionLog logEntity = executionLogRepository.findById(logId).orElse(null);
            if (logEntity == null) {
                log.warn("Cannot complete node execution - log not found: {}", logId);
                return;
            }

            logEntity.markCompleted(status);

            if (errorMessage != null) {
                logEntity.setError(errorMessage, errorType);
            }

            // Always store details if provided (e.g. counts for success, full details for
            // failure)
            if (detailsObject != null) {
                try {
                    String detailsJson = objectMapper.writeValueAsString(detailsObject);
                    logEntity.setDetailsJson(detailsJson);
                } catch (JsonProcessingException e) {
                    log.error("Failed to serialize details object for log: {}", logId, e);
                    SentryLogger.logError(e, "Failed to serialize workflow execution details", Map.of(
                            "log.id", logId,
                            "status", status.name(),
                            "operation", "completeNodeExecutionWithStatus"));
                }
            }

            executionLogRepository.save(logEntity);
            log.debug("Completed node execution log: {}, status: {}, execution time: {}ms",
                    logId, status, logEntity.getExecutionTimeMs());
        } catch (Exception e) {
            log.error("Failed to complete node execution: {}", logId, e);
            SentryLogger.logError(e, "Failed to complete node execution", Map.of(
                    "log.id", logId,
                    "status", status.name(),
                    "operation", "completeNodeExecutionWithStatus"));
        }
    }

    @Cacheable(value = "executionLogs", key = "#executionId")
    public List<vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionLogDTO> getLogsByExecutionId(
            String executionId) {
        return executionLogRepository.findByWorkflowExecutionIdOrderByCreatedAtAsc(executionId)
                .stream()
                .map(this::convertToDTO)
                .collect(java.util.stream.Collectors.toList());
    }

    public org.springframework.data.domain.Page<vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionLogDTO> getLogsByTimeRange(
            Instant start, Instant end,
            org.springframework.data.domain.Pageable pageable) {
        return executionLogRepository.findByTimeRange(start, end, pageable)
                .map(this::convertToDTO);
    }

    public List<vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionLogDTO> getLogsByNodeTemplateId(
            String nodeTemplateId) {
        return executionLogRepository.findByNodeTemplateId(nodeTemplateId)
                .stream()
                .map(this::convertToDTO)
                .collect(java.util.stream.Collectors.toList());
    }

    @Cacheable(value = "nodeLogs", key = "#executionId + '_' + #nodeId")
    public List<vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionLogDTO> getLogsByExecutionIdAndNodeId(
            String executionId, String nodeId) {
        return executionLogRepository.findByWorkflowExecutionIdAndNodeTemplateId(executionId, nodeId)
                .stream()
                .map(this::convertToDTO)
                .collect(java.util.stream.Collectors.toList());
    }

    private vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionLogDTO convertToDTO(
            WorkflowExecutionLog logEntity) {
        com.fasterxml.jackson.databind.JsonNode detailsNode = null;
        if (logEntity.getDetailsJson() != null) {
            try {
                detailsNode = objectMapper.readTree(logEntity.getDetailsJson());
            } catch (JsonProcessingException e) {
                log.error("Failed to parse details JSON for log: {}", logEntity.getId(), e);
                SentryLogger.logError(e, "Failed to parse workflow execution details JSON", Map.of(
                        "log.id", logEntity.getId(),
                        "operation", "convertToDTO"));
            }
        }

        return vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionLogDTO.builder()
                .id(logEntity.getId())
                .workflowExecutionId(logEntity.getWorkflowExecutionId())
                .nodeTemplateId(logEntity.getNodeTemplateId())
                .nodeType(logEntity.getNodeType())
                .status(logEntity.getStatus())
                .startedAt(logEntity.getStartedAt())
                .completedAt(logEntity.getCompletedAt())
                .executionTimeMs(logEntity.getExecutionTimeMs())
                .details(detailsNode)
                .errorMessage(logEntity.getErrorMessage())
                .errorType(logEntity.getErrorType())
                .createdAt(logEntity.getCreatedAt())
                .updatedAt(logEntity.getUpdatedAt())
                .build();
    }

    /**
     * Sanitizes context to remove sensitive data and limit size.
     * Only keeps essential fields for debugging.
     */
    public Map<String, Object> sanitizeContext(Map<String, Object> context) {
        if (context == null || context.isEmpty()) {
            return Map.of();
        }

        // Maximum size for context data (in characters when serialized)
        final int MAX_CONTEXT_SIZE = 50000; // 50KB
        final int MAX_COLLECTION_SIZE = 100; // Max items in collections
        final int MAX_STRING_LENGTH = 5000; // Max length for string values

        // Sensitive field patterns (case-insensitive)
        final Set<String> SENSITIVE_PATTERNS = Set.of(
                "password", "passwd", "pwd", "secret", "token", "key", "apikey", "api_key",
                "authorization", "auth", "credential", "private", "ssn", "social_security",
                "credit_card", "card_number", "cvv", "pin", "otp", "orderlink");

        Map<String, Object> sanitized = new HashMap<>();
        int estimatedSize = 0;

        for (Map.Entry<String, Object> entry : context.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();

            // Check if field is sensitive
            if (isSensitiveField(key, SENSITIVE_PATTERNS)) {
                sanitized.put(key, "[REDACTED]");
                estimatedSize += key.length() + 12; // "[REDACTED]".length()
                continue;
            }

            // Sanitize the value
            Object sanitizedValue = sanitizeValue(value, MAX_COLLECTION_SIZE, MAX_STRING_LENGTH);

            // Estimate size
            String valueStr = String.valueOf(sanitizedValue);
            int entrySize = key.length() + valueStr.length();

            // Check if adding this entry would exceed max size
            if (estimatedSize + entrySize > MAX_CONTEXT_SIZE) {
                sanitized.put("_truncated", true);
                sanitized.put("_truncatedFields", context.size() - sanitized.size());
                break;
            }

            sanitized.put(key, sanitizedValue);
            estimatedSize += entrySize;
        }

        return sanitized;
    }

    /**
     * Checks if a field name matches sensitive patterns.
     */
    private boolean isSensitiveField(String fieldName, Set<String> patterns) {
        String lowerField = fieldName.toLowerCase();
        return patterns.stream().anyMatch(lowerField::contains);
    }

    /**
     * Sanitizes individual values (truncate strings, limit collections, etc.)
     */
    private Object sanitizeValue(Object value, int maxCollectionSize, int maxStringLength) {
        if (value == null) {
            return null;
        }

        // CRITICAL: Check for Hibernate proxies FIRST to avoid ByteBuddyInterceptor
        // serialization errors
        String className = value.getClass().getName();
        if (className.contains("HibernateProxy") || className.contains("$$") ||
                className.contains("ByteBuddyInterceptor") || className.contains("javassist")) {
            // Return simple string representation instead of trying to serialize
            try {
                return "[Proxy: " + value.getClass().getSuperclass().getSimpleName() + "]";
            } catch (Exception e) {
                return "[Proxy: Unknown]";
            }
        }

        // Also check for JPA entities from common packages
        if (className.contains(".entity.") || className.contains(".model.") || className.contains(".domain.")) {
            return "[Entity: " + value.getClass().getSimpleName() + "]";
        }

        // Truncate long strings
        if (value instanceof String) {
            String str = (String) value;
            if (str.length() > maxStringLength) {
                return str.substring(0, maxStringLength) + "... [truncated " + (str.length() - maxStringLength)
                        + " chars]";
            }
            return str;
        }

        // Limit collection sizes
        if (value instanceof List) {
            List<?> list = (List<?>) value;
            if (list.size() > maxCollectionSize) {
                List<Object> truncated = new ArrayList<>(list.subList(0, maxCollectionSize));
                truncated.add("[... " + (list.size() - maxCollectionSize) + " more items]");
                return truncated;
            }
            return list;
        }

        if (value instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) value;
            if (map.size() > maxCollectionSize) {
                Map<Object, Object> truncated = new HashMap<>();
                int count = 0;
                for (Map.Entry<?, ?> entry : map.entrySet()) {
                    if (count++ >= maxCollectionSize) {
                        break;
                    }
                    truncated.put(entry.getKey(), entry.getValue());
                }
                truncated.put("_truncated", (map.size() - maxCollectionSize) + " more entries");
                return truncated;
            }
            return map;
        }

        // Return primitives and simple types as-is
        if (value instanceof Number || value instanceof Boolean) {
            return value;
        }

        // For other complex objects, convert to string representation
        if (!isSimpleType(value)) {
            return "[Object: " + value.getClass().getSimpleName() + "]";
        }

        // Return other types as-is
        return value;
    }

    /**
     * Checks if the value is a simple type that can be safely serialized.
     */
    private boolean isSimpleType(Object value) {
        return value instanceof String ||
                value instanceof Number ||
                value instanceof Boolean ||
                value instanceof Character ||
                value instanceof java.util.Date ||
                value instanceof java.time.Instant ||
                value instanceof java.time.LocalDate ||
                value instanceof java.time.LocalDateTime ||
                value instanceof java.util.UUID;
    }

    /**
     * Creates a details object with common fields.
     * Helper method for node handlers.
     */
    public Map<String, Object> createBaseDetails(
            Map<String, Object> inputContext,
            Map<String, Object> outputContext,
            Integer totalItems,
            Integer successCount,
            Integer failureCount) {

        return Map.of(
                "inputContext", inputContext != null ? sanitizeContext(inputContext) : Map.of(),
                "outputContext", outputContext != null ? sanitizeContext(outputContext) : Map.of(),
                "totalItems", totalItems != null ? totalItems : 0,
                "successCount", successCount != null ? successCount : 0,
                "failureCount", failureCount != null ? failureCount : 0);
    }
}
