package vacademy.io.admin_core_service.features.workflow.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.workflow.dto.EnrollmentWorkflowRunDTO;
import vacademy.io.admin_core_service.features.workflow.service.EnrollmentWorkflowRunService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Exposes the enrollment workflow runs (and their per-node steps) attached to a
 * learner's enrollment(s) or to a course's package sessions, for the admin
 * dashboard tick/cross checklist.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/workflow/enrollment-runs")
@RequiredArgsConstructor
public class EnrollmentWorkflowRunController {

    private final EnrollmentWorkflowRunService enrollmentWorkflowRunService;
    private final WorkflowAccessGuard accessGuard;

    /**
     * @param instituteId        institute that owns the workflow
     * @param packageSessionIds  comma-separated package session ids (a learner's
     *                           enrollments, or all sessions of a course)
     */
    @GetMapping
    public ResponseEntity<List<EnrollmentWorkflowRunDTO>> getEnrollmentRuns(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("packageSessionIds") String packageSessionIds,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {

        accessGuard.requireStaffForList("workflow.getEnrollmentRuns", user, instituteId);

        List<String> ids = Arrays.stream(packageSessionIds.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toList());

        log.info("Fetching enrollment workflow runs for instituteId={}, packageSessionIds={}", instituteId, ids);
        return ResponseEntity.ok(enrollmentWorkflowRunService.getRuns(instituteId, ids));
    }
}
