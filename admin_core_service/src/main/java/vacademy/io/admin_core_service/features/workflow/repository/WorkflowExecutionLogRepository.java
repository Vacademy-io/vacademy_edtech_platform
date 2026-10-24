package vacademy.io.admin_core_service.features.workflow.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecutionLog;
import vacademy.io.admin_core_service.features.workflow.enums.ExecutionLogStatus;

import java.time.Instant;
import java.util.List;

/**
 * Repository for WorkflowExecutionLog entity.
 * Provides methods for querying execution logs with various filters.
 */
@Repository
public interface WorkflowExecutionLogRepository extends JpaRepository<WorkflowExecutionLog, String> {

        /**
         * Find all logs for a specific workflow execution, ordered by creation time.
         */
        List<WorkflowExecutionLog> findByWorkflowExecutionIdOrderByCreatedAtAsc(String workflowExecutionId);

        /**
         * Same, for a whole page of executions at once. The learner Workflows tab renders every
         * run's steps inline; fetching them one execution at a time would be an N+1 across the
         * page. Served by {@code idx_workflow_execution_id}.
         */
        List<WorkflowExecutionLog> findByWorkflowExecutionIdInOrderByCreatedAtAsc(
                        List<String> workflowExecutionIds);

        /**
         * Find logs for a specific node in a workflow execution.
         */
        List<WorkflowExecutionLog> findByWorkflowExecutionIdAndNodeTemplateId(String workflowExecutionId,
                        String nodeTemplateId);

        /**
         * Find all logs for a specific workflow execution with pagination.
         */
        Page<WorkflowExecutionLog> findByWorkflowExecutionId(String workflowExecutionId, Pageable pageable);

        /**
         * Find logs by workflow execution ID and status.
         */
        List<WorkflowExecutionLog> findByWorkflowExecutionIdAndStatus(
                        String workflowExecutionId,
                        ExecutionLogStatus status);

        /**
         * Find logs by node template ID.
         */
        List<WorkflowExecutionLog> findByNodeTemplateId(String nodeTemplateId);

        /**
         * Find logs by node type.
         */
        List<WorkflowExecutionLog> findByNodeType(String nodeType);

        /**
         * Find failed or partially successful logs for a workflow execution.
         */
        @Query("SELECT wel FROM WorkflowExecutionLog wel WHERE wel.workflowExecutionId = :workflowExecutionId " +
                        "AND wel.status IN ('FAILED', 'PARTIAL_SUCCESS') ORDER BY wel.createdAt ASC")
        List<WorkflowExecutionLog> findFailedOrPartialLogs(@Param("workflowExecutionId") String workflowExecutionId);

        /**
         * Find logs within a time range.
         */
        @Query("SELECT wel FROM WorkflowExecutionLog wel WHERE wel.createdAt BETWEEN :startTime AND :endTime " +
                        "ORDER BY wel.createdAt DESC")
        Page<WorkflowExecutionLog> findByTimeRange(
                        @Param("startTime") Instant startTime,
                        @Param("endTime") Instant endTime,
                        Pageable pageable);

        /**
         * Count logs by status for a workflow execution.
         */
        @Query("SELECT wel.status, COUNT(wel) FROM WorkflowExecutionLog wel " +
                        "WHERE wel.workflowExecutionId = :workflowExecutionId GROUP BY wel.status")
        List<Object[]> countByStatusForExecution(@Param("workflowExecutionId") String workflowExecutionId);

        /**
         * Find logs with errors for a specific node type.
         */
        @Query("SELECT wel FROM WorkflowExecutionLog wel WHERE wel.nodeType = :nodeType " +
                        "AND wel.status IN ('FAILED', 'PARTIAL_SUCCESS') AND wel.errorMessage IS NOT NULL " +
                        "ORDER BY wel.createdAt DESC")
        Page<WorkflowExecutionLog> findErrorLogsByNodeType(
                        @Param("nodeType") String nodeType,
                        Pageable pageable);

        /**
         * Delete logs older than a specific date (for cleanup).
         */
        void deleteByCreatedAtBefore(Instant cutoffDate);
}
