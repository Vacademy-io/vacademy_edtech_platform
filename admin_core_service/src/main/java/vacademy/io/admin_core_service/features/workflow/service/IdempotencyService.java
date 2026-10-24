package vacademy.io.admin_core_service.features.workflow.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.workflow.entity.Workflow;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecution;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowSchedule;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowTrigger;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowExecutionStatus;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowType;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowScheduleRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTriggerRepository;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class IdempotencyService {

    private final WorkflowExecutionRepository workflowExecutionRepository;
    private final WorkflowRepository workflowRepository;
    private final WorkflowScheduleRepository workflowScheduleRepository;
    private final WorkflowTriggerRepository workflowTriggerRepository;

    @Transactional
    public WorkflowExecution markAsProcessing(String idempotencyKey, String workflowId, String scheduleId) {
        try {
            Workflow workflow = workflowRepository.findById(workflowId)
                    .orElseThrow(() -> new RuntimeException("Workflow not found: " + workflowId));

            WorkflowSchedule schedule = null;
            if (scheduleId != null && !scheduleId.isBlank()) {
                schedule = workflowScheduleRepository.findById(scheduleId).orElse(null);
            }

            WorkflowExecution execution = WorkflowExecution.builder()
                    .idempotencyKey(idempotencyKey)
                    .workflow(workflow)
                    .workflowSchedule(schedule)
                    .workflowType(WorkflowType.SCHEDULED)
                    .status(WorkflowExecutionStatus.PROCESSING)
                    .startedAt(Instant.now())
                    .build();

            WorkflowExecution saved = workflowExecutionRepository.save(execution);
            log.debug("Created new SCHEDULED execution record with status PROCESSING: {}", idempotencyKey);
            return saved;

        } catch (DataIntegrityViolationException e) {
            // Let DB enforce idempotency constraint and fail fast
            log.error("Duplicate idempotency key detected (DB constraint violation): {}", idempotencyKey, e);
            throw e; // rethrow as-is (so transaction rolls back)
        }
    }

    /**
     * Mark a trigger-based workflow execution as processing.
     * Creates a WorkflowExecution record with type EVENT_DRIVEN.
     *
     * @param idempotencyKey Unique key for deduplication
     * @param workflowId     ID of the workflow to execute
     * @param triggerId      ID of the workflow trigger
     * @return Created WorkflowExecution entity
     * @throws DataIntegrityViolationException if duplicate idempotency key exists
     */
    @Transactional
    public WorkflowExecution markAsProcessingForTrigger(String idempotencyKey, String workflowId, String triggerId) {
        try {
            Workflow workflow = workflowRepository.findById(workflowId)
                    .orElseThrow(() -> new RuntimeException("Workflow not found: " + workflowId));

            WorkflowTrigger trigger = null;
            if (triggerId != null && !triggerId.isBlank()) {
                trigger = workflowTriggerRepository.findById(triggerId)
                        .orElseThrow(() -> new RuntimeException("Workflow trigger not found: " + triggerId));
            }

            WorkflowExecution execution = WorkflowExecution.builder()
                    .idempotencyKey(idempotencyKey)
                    .workflow(workflow)
                    .workflowTrigger(trigger)
                    .workflowType(WorkflowType.EVENT_DRIVEN)
                    .status(WorkflowExecutionStatus.PROCESSING)
                    .startedAt(Instant.now())
                    .build();

            WorkflowExecution saved = workflowExecutionRepository.save(execution);
            log.debug("Created new EVENT_DRIVEN execution record with status PROCESSING: {}", idempotencyKey);
            return saved;

        } catch (DataIntegrityViolationException e) {
            // Let DB enforce idempotency constraint and fail fast
            log.error("Duplicate idempotency key detected (DB constraint violation): {}", idempotencyKey, e);
            throw e; // rethrow as-is (so transaction rolls back)
        }
    }

    /**
     * Attach the subject (the learner this run is FOR) and a storable snapshot of the seed
     * context to an execution that was just marked PROCESSING.
     *
     * <p>Split from {@code markAsProcessing*} because the seed context is only assembled
     * afterwards — it has to carry the execution's own id. Best-effort by design: this is
     * bookkeeping for the learner-profile Workflows tab and its Retry button, and a failure
     * to record it must never stop the workflow from running. The cost of a failure is one
     * run missing from one tab.</p>
     */
    @Transactional
    public void recordSubjectAndContext(String executionId, String subjectUserId,
            Map<String, Object> storableSeedContext) {
        if (executionId == null || executionId.isBlank()) {
            return;
        }
        try {
            workflowExecutionRepository.findById(executionId).ifPresent(execution -> {
                execution.setSubjectUserId(subjectUserId);
                execution.setSeedContext(storableSeedContext);
                workflowExecutionRepository.save(execution);
            });
        } catch (Exception e) {
            log.warn("Could not record subject/context on execution {}: {}", executionId, e.getMessage());
        }
    }

    /**
     * Create the execution row for a manual retry of {@code original}. Carries the original's
     * workflow, trigger, schedule, type, subject and seed context across so the retry appears
     * on the same learner's tab and is itself retryable, while
     * {@code retryOfExecutionId}/{@code retriedByUserId} record where it came from.
     *
     * <p>A fresh {@code idempotencyKey} is mandatory: the column is UNIQUE, and reusing the
     * original's would be the dedup mechanism refusing the very thing the admin asked for.</p>
     */
    @Transactional
    public WorkflowExecution createRetryExecution(WorkflowExecution original, String idempotencyKey,
            String retriedByUserId) {
        WorkflowExecution retry = WorkflowExecution.builder()
                .idempotencyKey(idempotencyKey)
                .workflow(original.getWorkflow())
                .workflowSchedule(original.getWorkflowSchedule())
                .workflowTrigger(original.getWorkflowTrigger())
                .workflowType(original.getWorkflowType())
                .status(WorkflowExecutionStatus.PROCESSING)
                .startedAt(Instant.now())
                .subjectUserId(original.getSubjectUserId())
                .seedContext(original.getSeedContext())
                .retryOfExecutionId(original.getId())
                .retriedByUserId(retriedByUserId)
                .build();

        WorkflowExecution saved = workflowExecutionRepository.save(retry);
        log.info("Created RETRY execution {} for original execution {} (by user {})",
                saved.getId(), original.getId(), retriedByUserId);
        return saved;
    }

    @Transactional
    public WorkflowExecution markAsCompleted(String idempotencyKey, Map<String, Object> result) {
        // A run that hit a long DELAY returns normally with __workflow_paused — the execution
        // row was just set to PAUSED by DelayNodeHandler and a WAITING resume-state row exists.
        // Marking COMPLETED here would clobber that and show a mid-drip run as finished.
        if (result != null && Boolean.TRUE.equals(result.get("__workflow_paused"))) {
            log.info("Execution {} paused mid-run (persistent delay) — leaving status PAUSED", idempotencyKey);
            return workflowExecutionRepository.findByIdempotencyKey(idempotencyKey).orElse(null);
        }

        Optional<WorkflowExecution> executionOpt = workflowExecutionRepository.findByIdempotencyKey(idempotencyKey);

        if (executionOpt.isEmpty()) {
            log.warn("Cannot mark as completed - execution not found: {}", idempotencyKey);
            return null;
        }

        WorkflowExecution execution = executionOpt.get();
        execution.setStatus(WorkflowExecutionStatus.COMPLETED);
        execution.setCompletedAt(Instant.now());
        execution.setErrorMessage(null);

        WorkflowExecution saved = workflowExecutionRepository.save(execution);
        log.debug("Marked execution as COMPLETED: {}", idempotencyKey);
        return saved;
    }

    @Transactional
    public WorkflowExecution markAsFailed(String idempotencyKey, String errorMessage) {
        Optional<WorkflowExecution> executionOpt = workflowExecutionRepository.findByIdempotencyKey(idempotencyKey);

        if (executionOpt.isEmpty()) {
            log.warn("Cannot mark as failed - execution not found: {}", idempotencyKey);
            return null;
        }

        WorkflowExecution execution = executionOpt.get();
        if (execution.getStatus() == WorkflowExecutionStatus.COMPLETED) {
            return execution;
        }
        execution.setStatus(WorkflowExecutionStatus.FAILED);
        execution.setCompletedAt(Instant.now());
        execution.setErrorMessage(errorMessage);

        WorkflowExecution saved = workflowExecutionRepository.save(execution);
        log.debug("Marked execution as FAILED: {}", idempotencyKey);
        return saved;
    }

    @Transactional(readOnly = true)
    public Optional<WorkflowExecution> getExecutionStatus(String idempotencyKey) {
        return workflowExecutionRepository.findByIdempotencyKey(idempotencyKey);
    }

    @Transactional
    public void clearIdempotencyKey(String idempotencyKey) {
        Optional<WorkflowExecution> execution = workflowExecutionRepository.findByIdempotencyKey(idempotencyKey);
        execution.ifPresent(workflowExecutionRepository::delete);
        log.debug("Cleared idempotency key: {}", idempotencyKey);
    }

    @Transactional(readOnly = true)
    public Map<String, Long> getStatistics() {
        return Map.of(
                "total_entries", workflowExecutionRepository.count(),
                "processing_count", workflowExecutionRepository.countByStatus(WorkflowExecutionStatus.PROCESSING),
                "completed_count", workflowExecutionRepository.countByStatus(WorkflowExecutionStatus.COMPLETED),
                "failed_count", workflowExecutionRepository.countByStatus(WorkflowExecutionStatus.FAILED),
                "pending_count", workflowExecutionRepository.countByStatus(WorkflowExecutionStatus.PENDING));
    }
}
