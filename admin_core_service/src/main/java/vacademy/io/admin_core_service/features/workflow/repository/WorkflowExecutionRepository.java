package vacademy.io.admin_core_service.features.workflow.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionProjection;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecution;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowExecutionStatus;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface WorkflowExecutionRepository extends JpaRepository<WorkflowExecution, String> {

        Optional<WorkflowExecution> findByIdempotencyKey(String idempotencyKey);

        boolean existsByIdempotencyKey(String idempotencyKey);

        /**
         * Pattern-match against {@code idempotency_key} to dedup re-emission
         * of the same event (eventId is encoded inside the key by
         * {@code EventBasedKeyGenerator} as
         * {@code trigger_<triggerId>_eventType_<eventName>_eventId_<eventId>},
         * not stored as its own column). Used by
         * {@code PackageSessionScheduler.emitMembershipExpiryReminders} to
         * skip plans it has already notified about. Pattern e.g.
         * {@code "%eventType_MEMBERSHIP_EXPIRY_eventId_<userPlanId>%"}. The
         * {@code since} filter scopes to recent rows so a long-ago execution
         * for the same id (e.g. a re-purchased plan) doesn't permanently
         * suppress new reminders.
         */
        @Query("SELECT COUNT(we) FROM WorkflowExecution we " +
                        "WHERE we.idempotencyKey LIKE :keyPattern " +
                        "  AND we.createdAt >= :since")
        long countByIdempotencyKeyLikeSince(@Param("keyPattern") String keyPattern,
                        @Param("since") Instant since);

        @Query("SELECT we FROM WorkflowExecution we WHERE we.idempotencyKey = :idempotencyKey AND we.status IN :statuses")
        Optional<WorkflowExecution> findByIdempotencyKeyAndStatusIn(@Param("idempotencyKey") String idempotencyKey,
                        @Param("statuses") List<WorkflowExecutionStatus> statuses);

        /**
         * Fetch workflow executions for the given triggers, newest first. Executions
         * are linked to their trigger by {@code workflow_trigger_id} (set at dispatch
         * in {@code WorkflowTriggerService}), which is reliable regardless of the
         * trigger's idempotency strategy — unlike the idempotency key, which is a
         * random UUID under the default strategy and therefore does NOT encode the
         * event/package-session id. For course-attached enrollment triggers the
         * trigger carries {@code eventId = packageSessionId}, so matching by trigger
         * ties an execution to a specific package session. The workflow is fetched
         * eagerly so callers can read its name outside the persistence context.
         */
        @Query("SELECT we FROM WorkflowExecution we JOIN FETCH we.workflow w " +
                        "WHERE we.workflowTrigger.id IN :triggerIds " +
                        "ORDER BY we.startedAt DESC")
        List<WorkflowExecution> findByWorkflowTriggerIdInOrderByStartedAtDesc(
                        @Param("triggerIds") List<String> triggerIds);

        /**
         * The automations that ran for one learner, newest first — backs the Workflows tab
         * on the learner side-view.
         *
         * <p>Scoped by institute as well as user because an auth user can be a learner at
         * more than one institute, and an admin of institute A must not see the runs
         * institute B fired for the same person. The institute comes off the workflow (the
         * execution has no institute column of its own).</p>
         *
         * <p>Backed by {@code idx_workflow_execution_subject_user} (V488), a partial index on
         * the non-null subject rows.</p>
         */
        @Query(value = "SELECT we FROM WorkflowExecution we JOIN FETCH we.workflow w " +
                        "WHERE we.subjectUserId = :userId " +
                        "  AND w.instituteId = :instituteId",
                        countQuery = "SELECT COUNT(we) FROM WorkflowExecution we " +
                                        "WHERE we.subjectUserId = :userId " +
                                        "  AND we.workflow.instituteId = :instituteId")
        Page<WorkflowExecution> findBySubjectUserId(@Param("userId") String userId,
                        @Param("instituteId") String instituteId,
                        Pageable pageable);

        /**
         * Load one execution with every association the Retry path copies onto the new run.
         *
         * <p>All three are {@code LAZY}, and retry deliberately runs OUTSIDE a transaction (the
         * new row must be committed before the async worker looks it up), so touching any of
         * them on a detached entity would throw {@code LazyInitializationException}. Fetching
         * them up-front is what makes the detached entity safe to read.</p>
         */
        @Query("SELECT we FROM WorkflowExecution we " +
                        "JOIN FETCH we.workflow " +
                        "LEFT JOIN FETCH we.workflowSchedule " +
                        "LEFT JOIN FETCH we.workflowTrigger " +
                        "WHERE we.id = :id")
        Optional<WorkflowExecution> findByIdForRetry(@Param("id") String id);

        List<WorkflowExecution> findByWorkflowIdOrderByStartedAtDesc(String workflowId);

        List<WorkflowExecution> findByWorkflowScheduleIdOrderByStartedAtDesc(String workflowScheduleId);

        List<WorkflowExecution> findByStatusOrderByStartedAtDesc(WorkflowExecutionStatus status);

        @Query("SELECT we FROM WorkflowExecution we WHERE we.status = :status AND we.startedAt < :cutoffTime")
        List<WorkflowExecution> findStaleExecutions(@Param("status") WorkflowExecutionStatus status,
                        @Param("cutoffTime") Instant cutoffTime);

        long countByWorkflowId(String workflowId);

        long countByWorkflowScheduleId(String workflowScheduleId);

        long countByStatus(WorkflowExecutionStatus status);

        @Query("SELECT COUNT(we) FROM WorkflowExecution we WHERE we.workflow.id = :workflowId AND we.status = :status")
        long countByWorkflowIdAndStatus(@Param("workflowId") String workflowId,
                        @Param("status") WorkflowExecutionStatus status);

        @Query("SELECT we.id as id, " +
                        "we.idempotencyKey as idempotencyKey, " +
                        "we.status as status, " +
                        "we.errorMessage as errorMessage, " +
                        "we.startedAt as startedAt, " +
                        "we.completedAt as completedAt, " +
                        "we.createdAt as createdAt, " +
                        "we.updatedAt as updatedAt, " +
                        "we.workflow.id as workflowId, " +
                        "we.workflow.name as workflowName, " +
                        "we.workflowSchedule.id as workflowScheduleId " +
                        "FROM WorkflowExecution we " +
                        "WHERE we.workflow.instituteId = :instituteId " +
                        "AND we.workflow.id IN :workflowIds " +
                        "AND (:statuses IS NULL OR we.status IN :statuses) " +
                        "AND we.createdAt >= COALESCE(:startDate, we.createdAt) " +
                        "AND we.createdAt <= COALESCE(:endDate, we.createdAt)")
        Page<WorkflowExecutionProjection> findWorkflowExecutionsWithFilters(
                        @Param("instituteId") String instituteId,
                        @Param("workflowIds") List<String> workflowIds,
                        @Param("statuses") List<WorkflowExecutionStatus> statuses,
                        @Param("startDate") Instant startDate,
                        @Param("endDate") Instant endDate,
                        Pageable pageable);

        @Query(value = "SELECT " +
                        "COUNT(*) as total, " +
                        "COUNT(*) FILTER (WHERE we.status = 'COMPLETED') as completed, " +
                        "COUNT(*) FILTER (WHERE we.status = 'FAILED') as failed, " +
                        "COUNT(*) FILTER (WHERE we.status = 'PROCESSING') as processing, " +
                        "COUNT(*) FILTER (WHERE we.status = 'PENDING') as pending, " +
                        "COALESCE(AVG(EXTRACT(EPOCH FROM (we.completed_at - we.started_at)) * 1000) FILTER (WHERE we.completed_at IS NOT NULL), 0) as avg_execution_time_ms " +
                        "FROM workflow_execution we " +
                        "JOIN workflow w ON we.workflow_id = w.id " +
                        "WHERE w.id = :workflowId " +
                        "AND (CAST(:startDate AS TIMESTAMP) IS NULL OR we.created_at >= :startDate) " +
                        "AND (CAST(:endDate AS TIMESTAMP) IS NULL OR we.created_at <= :endDate)",
                        nativeQuery = true)
        Object[] getExecutionSummary(@Param("workflowId") String workflowId,
                        @Param("startDate") Instant startDate,
                        @Param("endDate") Instant endDate);
}
