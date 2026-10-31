package vacademy.io.admin_core_service.features.workflow.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.workflow.dto.PagedUserWorkflowRunResponseDTO;
import vacademy.io.admin_core_service.features.workflow.dto.UserWorkflowRunDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowRetryResponseDTO;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecution;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecutionLog;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowExecutionStatus;
import vacademy.io.admin_core_service.features.workflow.repository.NodeTemplateRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionLogRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionRepository;
import vacademy.io.admin_core_service.features.workflow.util.WorkflowSubjectResolver;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Backs the "Workflows" tab on the learner side-view: which automations ran for THIS
 * person, whether each worked, and re-running one on demand.
 *
 * <p>Runs are found by {@code workflow_execution.subject_user_id}, stamped at dispatch by
 * {@code WorkflowTriggerService} (V488). Runs that pre-date that column are invisible here
 * and not retryable — there is no way to know who they were for, and guessing from an
 * idempotency key would attribute other people's automations to this learner.</p>
 *
 * <p>Read paths are strictly additive over the existing engine: nothing here changes how a
 * workflow is dispatched, scheduled or resumed. Retry goes through the ordinary
 * {@link AsyncWorkflowExecutor} with a brand-new execution row, so a re-run is
 * indistinguishable from any other run to the engine, and the original row is never
 * mutated.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserWorkflowRunService {

    private final WorkflowExecutionRepository workflowExecutionRepository;
    private final WorkflowExecutionLogRepository workflowExecutionLogRepository;
    private final NodeTemplateRepository nodeTemplateRepository;
    private final IdempotencyService idempotencyService;
    private final AsyncWorkflowExecutor asyncWorkflowExecutor;
    private final WorkflowSubjectResolver workflowSubjectResolver;

    private static final String NOT_RECORDED_REASON =
            "This run happened before re-running was supported, so its original inputs weren't saved.";
    private static final String IN_PROGRESS_REASON =
            "This run is still in progress.";

    @Transactional(readOnly = true)
    public PagedUserWorkflowRunResponseDTO getRunsForUser(String userId, String instituteId,
            int pageNo, int pageSize) {
        if (!StringUtils.hasText(userId)) {
            throw new VacademyException("userId is required");
        }
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("instituteId is required");
        }

        Page<WorkflowExecution> page = workflowExecutionRepository.findBySubjectUserId(
                userId, instituteId,
                PageRequest.of(pageNo, pageSize, Sort.by(Sort.Direction.DESC, "startedAt")));

        List<WorkflowExecution> executions = page.getContent();
        Map<String, List<WorkflowExecutionLog>> logsByExecutionId = loadLogs(executions);
        Map<String, NodeTemplate> templatesById = loadNodeTemplates(logsByExecutionId);

        List<UserWorkflowRunDTO> content = executions.stream()
                .map(execution -> toRunDto(execution,
                        logsByExecutionId.getOrDefault(execution.getId(), List.of()),
                        templatesById))
                .toList();

        return PagedUserWorkflowRunResponseDTO.builder()
                .content(content)
                .pageNumber(page.getNumber())
                .pageSize(page.getSize())
                .totalElements(page.getTotalElements())
                .totalPages(page.getTotalPages())
                .last(page.isLast())
                .first(page.isFirst())
                .build();
    }

    /**
     * Re-run a past execution with the inputs it originally started from.
     *
     * <p>A retry is a NEW execution, never a mutation of the old one: the original row keeps
     * its status and error so the history stays honest about what happened the first time,
     * and the new row records {@code retry_of_execution_id} so the tab can show the pair.
     * The new row also needs its own {@code idempotency_key} — that column is UNIQUE, and
     * reusing the original's would have the dedup mechanism reject the retry.</p>
     *
     * <p>Dispatch is asynchronous ({@link AsyncWorkflowExecutor}, the same path the trigger
     * queue uses) because a workflow can take far longer than an HTTP request should. The
     * caller gets the new execution id back immediately and polls the run list.</p>
     *
     * <p><b>Deliberately NOT {@code @Transactional}.</b> {@code executeAsync} hands the run to
     * another thread immediately, and that thread finishes by calling
     * {@code markAsCompleted(idempotencyKey)} in its OWN transaction. If this method held a
     * transaction, the new execution row would still be uncommitted when the worker looked it
     * up — the lookup would miss, the completion would be dropped, and the run would sit at
     * PROCESSING forever (which also permanently blocks retrying it again, since a PROCESSING
     * run is refused below). Letting {@code createRetryExecution} commit on return, and only
     * then dispatching, closes that race. Same reasoning as the afterCommit deferral in
     * {@code StudentRegistrationManager.triggerEnrollmentWorkflow}.</p>
     */
    public WorkflowRetryResponseDTO retry(String executionId, String instituteId, String retriedByUserId) {
        // findByIdForRetry, not findById: without a transaction the entity comes back detached,
        // so workflow/schedule/trigger must already be fetched or reading them throws.
        WorkflowExecution original = workflowExecutionRepository.findByIdForRetry(executionId)
                .orElseThrow(() -> new VacademyException("Workflow execution not found: " + executionId));

        if (original.getWorkflow() == null) {
            throw new VacademyException("This run's workflow no longer exists, so it cannot be re-run.");
        }
        // Scope-check against the caller's institute for the same reason the list query does:
        // an execution id is guessable, and a run belongs to exactly one institute's workflow.
        if (StringUtils.hasText(instituteId)
                && !instituteId.equals(original.getWorkflow().getInstituteId())) {
            throw new VacademyException("Workflow execution not found: " + executionId);
        }
        if (original.getStatus() == WorkflowExecutionStatus.PROCESSING) {
            throw new VacademyException(IN_PROGRESS_REASON + " Wait for it to finish before re-running it.");
        }
        if (original.getSeedContext() == null || original.getSeedContext().isEmpty()) {
            throw new VacademyException(NOT_RECORDED_REASON);
        }

        String idempotencyKey = "retry_" + original.getId() + "_" + UUID.randomUUID();
        WorkflowExecution retry = idempotencyService.createRetryExecution(original, idempotencyKey, retriedByUserId);

        Map<String, Object> ctx = workflowSubjectResolver.toRetryContext(original.getSeedContext());
        ctx.put("executionId", retry.getId());
        ctx.put("retryOfExecutionId", original.getId());
        // Handlers that branch on "was this a person pressing a button" (and anything reading
        // when the run happened) must see the retry, not the original event's timestamp.
        ctx.put("retriedManually", true);
        ctx.put("triggerTime", Instant.now().toString());

        try {
            asyncWorkflowExecutor.executeAsync(original.getWorkflow().getId(), idempotencyKey, ctx);
        } catch (Exception e) {
            // The row is already committed, so a rejected hand-off (saturated executor, shutting
            // down) would otherwise leave it stuck at PROCESSING and un-retryable. Mark it FAILED
            // with the real reason so the tab shows what happened and the button comes back.
            log.error("Could not queue retry {} of execution {}: {}",
                    retry.getId(), original.getId(), e.getMessage(), e);
            idempotencyService.markAsFailed(idempotencyKey, "Could not queue the re-run: " + e.getMessage());
            throw new VacademyException("Could not start the re-run right now — please try again shortly.");
        }

        log.info("Queued retry {} of execution {} (workflow {}) by user {}",
                retry.getId(), original.getId(), original.getWorkflow().getId(), retriedByUserId);

        return WorkflowRetryResponseDTO.builder()
                .executionId(retry.getId())
                .retryOfExecutionId(original.getId())
                .workflowId(original.getWorkflow().getId())
                .workflowName(original.getWorkflow().getName())
                .build();
    }

    // ── mapping helpers ──────────────────────────────────────────────────────────────

    private Map<String, List<WorkflowExecutionLog>> loadLogs(List<WorkflowExecution> executions) {
        if (executions.isEmpty()) {
            return Map.of();
        }
        List<String> ids = executions.stream().map(WorkflowExecution::getId).toList();
        return workflowExecutionLogRepository.findByWorkflowExecutionIdInOrderByCreatedAtAsc(ids)
                .stream()
                .collect(Collectors.groupingBy(WorkflowExecutionLog::getWorkflowExecutionId,
                        LinkedHashMap::new, Collectors.toList()));
    }

    private Map<String, NodeTemplate> loadNodeTemplates(Map<String, List<WorkflowExecutionLog>> logsByExecutionId) {
        List<String> nodeTemplateIds = logsByExecutionId.values().stream()
                .flatMap(List::stream)
                .map(WorkflowExecutionLog::getNodeTemplateId)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        if (nodeTemplateIds.isEmpty()) {
            return Map.of();
        }
        Map<String, NodeTemplate> byId = new LinkedHashMap<>();
        nodeTemplateRepository.findAllById(nodeTemplateIds).forEach(t -> byId.put(t.getId(), t));
        return byId;
    }

    private UserWorkflowRunDTO toRunDto(WorkflowExecution execution, List<WorkflowExecutionLog> logs,
            Map<String, NodeTemplate> templatesById) {

        List<UserWorkflowRunDTO.Step> steps = new ArrayList<>();
        for (WorkflowExecutionLog logEntity : logs) {
            NodeTemplate template = templatesById.get(logEntity.getNodeTemplateId());
            String nodeName = template != null && StringUtils.hasText(template.getNodeName())
                    ? template.getNodeName()
                    : logEntity.getNodeType();
            steps.add(UserWorkflowRunDTO.Step.builder()
                    .logId(logEntity.getId())
                    .nodeTemplateId(logEntity.getNodeTemplateId())
                    .nodeName(nodeName)
                    .nodeType(logEntity.getNodeType())
                    .status(logEntity.getStatus())
                    .errorMessage(logEntity.getErrorMessage())
                    .errorType(logEntity.getErrorType())
                    .startedAt(logEntity.getStartedAt())
                    .completedAt(logEntity.getCompletedAt())
                    .executionTimeMs(logEntity.getExecutionTimeMs())
                    .build());
        }

        boolean hasSeedContext = execution.getSeedContext() != null && !execution.getSeedContext().isEmpty();
        boolean inProgress = execution.getStatus() == WorkflowExecutionStatus.PROCESSING;
        String blockedReason = inProgress ? IN_PROGRESS_REASON : (hasSeedContext ? null : NOT_RECORDED_REASON);

        return UserWorkflowRunDTO.builder()
                .executionId(execution.getId())
                .workflowId(execution.getWorkflow() != null ? execution.getWorkflow().getId() : null)
                .workflowName(execution.getWorkflow() != null ? execution.getWorkflow().getName() : null)
                .workflowType(execution.getWorkflowType() != null ? execution.getWorkflowType().name() : null)
                .eventName(resolveEventName(execution))
                .status(execution.getStatus())
                .errorMessage(execution.getErrorMessage())
                .startedAt(execution.getStartedAt())
                .completedAt(execution.getCompletedAt())
                .retryable(blockedReason == null)
                .retryBlockedReason(blockedReason)
                .retryOfExecutionId(execution.getRetryOfExecutionId())
                .retriedByUserId(execution.getRetriedByUserId())
                .steps(steps)
                .build();
    }

    /**
     * The event that started the run. Read from the stored seed context's
     * {@code triggerEvents} rather than by touching {@code execution.workflowTrigger} — the
     * trigger is a lazy association whose row may since have been deleted, and a missing
     * label is not worth an extra query per run.
     */
    private String resolveEventName(WorkflowExecution execution) {
        Map<String, Object> seed = execution.getSeedContext();
        if (seed == null) {
            return null;
        }
        Object event = seed.get("triggerEvents");
        return event != null ? event.toString() : null;
    }
}
