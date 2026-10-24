package vacademy.io.admin_core_service.features.workflow.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.workflow.dto.PagedUserWorkflowRunResponseDTO;
import vacademy.io.admin_core_service.features.workflow.dto.PagedWorkflowExecutionResponseDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionFilterDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionSummaryDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowRetryResponseDTO;
import vacademy.io.admin_core_service.features.workflow.service.UserWorkflowRunService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowExecutionService;
import vacademy.io.common.auth.config.PageConstants;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.Instant;

import static vacademy.io.common.auth.config.PageConstants.DEFAULT_PAGE_NUMBER;

@Slf4j
@RestController
@RequestMapping("/admin-core-service/v1/workflow-execution")
@RequiredArgsConstructor
public class WorkflowExecutionController {

    private final WorkflowExecutionService workflowExecutionService;
    private final UserWorkflowRunService userWorkflowRunService;

    @PostMapping("/list")
    public ResponseEntity<PagedWorkflowExecutionResponseDTO> getWorkflowExecutions(
            @RequestBody WorkflowExecutionFilterDTO filter,
            @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
            @RequestParam(value = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE, required = false) int pageSize) {

        log.info("Getting workflow executions for instituteId: {}, workflowIds: {}, statuses: {}, page: {}, size: {}",
                filter.getInstituteId(), filter.getWorkflowIds(), filter.getStatuses(), pageNo, pageSize);

        PagedWorkflowExecutionResponseDTO response = workflowExecutionService.getWorkflowExecutions(filter, pageNo,
                pageSize);

        log.info("Retrieved {} workflow executions out of {} total",
                response.getContent().size(), response.getTotalElements());

        return ResponseEntity.ok(response);
    }

    @GetMapping("/summary")
    public ResponseEntity<WorkflowExecutionSummaryDTO> getExecutionSummary(
            @RequestParam("workflowId") String workflowId,
            @RequestParam(value = "startDate", required = false) Instant startDate,
            @RequestParam(value = "endDate", required = false) Instant endDate) {

        log.info("Getting execution summary for workflowId: {}", workflowId);
        WorkflowExecutionSummaryDTO summary = workflowExecutionService.getExecutionSummary(workflowId, startDate, endDate);
        return ResponseEntity.ok(summary);
    }

    // =================== Per-learner runs (side-view Workflows tab) ===================

    /**
     * The automations that ran for one learner/lead, newest first — the learner side-view's
     * Workflows tab. Only runs whose subject was recorded at dispatch appear; see
     * {@link vacademy.io.admin_core_service.features.workflow.service.UserWorkflowRunService}.
     */
    @GetMapping("/user/{userId}")
    public ResponseEntity<PagedUserWorkflowRunResponseDTO> getRunsForUser(
            @PathVariable("userId") String userId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
            @RequestParam(value = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE, required = false) int pageSize) {

        log.info("Getting workflow runs for userId: {}, instituteId: {}, page: {}, size: {}",
                userId, instituteId, pageNo, pageSize);
        return ResponseEntity.ok(
                userWorkflowRunService.getRunsForUser(userId, instituteId, pageNo, pageSize));
    }

    /**
     * Re-run a past execution with the inputs it originally started from. Creates a NEW
     * execution (the original is left exactly as it was) and dispatches it asynchronously,
     * so the response describes the queued run, not its outcome.
     */
    @PostMapping("/{executionId}/retry")
    public ResponseEntity<WorkflowRetryResponseDTO> retryExecution(
            @PathVariable("executionId") String executionId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {

        log.info("Retrying workflow execution {} for instituteId {} (requested by {})",
                executionId, instituteId, user != null ? user.getUserId() : null);
        return ResponseEntity.ok(userWorkflowRunService.retry(
                executionId, instituteId, user != null ? user.getUserId() : null));
    }
}
