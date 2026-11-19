package vacademy.io.admin_core_service.features.workflow.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecutionLog;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowExecutionLogger;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/admin-core-service/workflow/logs")
@RequiredArgsConstructor
public class WorkflowLogController {

    private final WorkflowExecutionLogger workflowExecutionLogger;
    private final WorkflowAccessGuard accessGuard;

    @GetMapping("/execution/{executionId}")
    public ResponseEntity<List<vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionLogDTO>> getLogsByExecutionId(
            @PathVariable String executionId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireStaffForExecution(user, executionId);
        return ResponseEntity.ok(workflowExecutionLogger.getLogsByExecutionId(executionId));
    }

    @GetMapping("/execution/{executionId}/node/{nodeId}")
    public ResponseEntity<List<vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionLogDTO>> getLogsByExecutionIdAndNodeId(
            @PathVariable String executionId,
            @PathVariable String nodeId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireStaffForExecution(user, executionId);
        return ResponseEntity.ok(workflowExecutionLogger.getLogsByExecutionIdAndNodeId(executionId, nodeId));
    }

    @GetMapping("/time-range")
    public ResponseEntity<Page<vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionLogDTO>> getLogsByTimeRange(
            @RequestParam Instant startTime,
            @RequestParam Instant endTime,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails user) {

        // Spans every institute's runs, so platform super admins only.
        accessGuard.requireSuperAdmin(user);

        return ResponseEntity.ok(workflowExecutionLogger.getLogsByTimeRange(
                startTime,
                endTime,
                PageRequest.of(page, size, Sort.by("createdAt").descending())));
    }

    @GetMapping("/node-template/{nodeTemplateId}")
    public ResponseEntity<List<vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionLogDTO>> getLogsByNodeTemplateId(
            @PathVariable String nodeTemplateId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireStaffForNodeTemplate(user, nodeTemplateId);
        return ResponseEntity.ok(workflowExecutionLogger.getLogsByNodeTemplateId(nodeTemplateId));
    }
}
