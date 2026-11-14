package vacademy.io.admin_core_service.features.course_settings.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.course_settings.dto.ApplyLmsConnectionRequest;
import vacademy.io.admin_core_service.features.course_settings.dto.LmsConnectionHealthDTO;
import vacademy.io.admin_core_service.features.course_settings.dto.LmsConnectionTestRequest;
import vacademy.io.admin_core_service.features.course_settings.dto.LmsConnectionTestResultDTO;
import vacademy.io.admin_core_service.features.course_settings.dto.PackageTriggerDTO;
import vacademy.io.admin_core_service.features.course_settings.service.LmsSettingService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * Institute-wide LMS visibility: which LMS the platform can integrate with and
 * which one is active for the institute. Editing the institute LMS config itself
 * goes through the existing {@code /institute/setting/v1/save-setting?settingKey=LMS_SETTING}.
 */
@RestController
@RequestMapping("/admin-core-service/lms/v1")
@RequiredArgsConstructor
public class LmsSettingController {

    private final LmsSettingService lmsSettingService;

    @GetMapping("/providers")
    public ResponseEntity<Map<String, Object>> getProviders(@RequestAttribute("user") CustomUserDetails userDetails,
                                                            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(lmsSettingService.getProviders(instituteId));
    }

    /**
     * Live-tests an LMS connection from the values in the settings form (before saving) so the
     * admin sees a clear, human-readable success/failure. Always 200 — the result body carries
     * {@code ok} + a friendly {@code message}.
     */
    @PostMapping("/test-connection")
    public ResponseEntity<LmsConnectionTestResultDTO> testConnection(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody LmsConnectionTestRequest request) {
        return ResponseEntity.ok(lmsSettingService.testConnection(request));
    }

    /**
     * Live health of every LMS connection the institute has saved — backs the dashboard
     * "LMS connection health" widget.
     *
     * <p>Unlike {@link #testConnection}, which tests unsaved form values, this tests the STORED
     * credentials server-side, so nothing secret is sent to the browser. The response carries only
     * each connection's host, never its key or token.</p>
     *
     * <p>Always 200: a connection being down is a result to render, not a request failure.</p>
     */
    @GetMapping("/connection-health")
    public ResponseEntity<LmsConnectionHealthDTO> getConnectionHealth(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "force", required = false, defaultValue = "false") boolean force) {
        // force=true is the widget's manual refresh: skip the 1-minute cache so an admin who has
        // just fixed a connection sees the real result instead of the failure that is still cached.
        return ResponseEntity.ok(force
                ? lmsSettingService.refreshConnectionHealth(instituteId)
                : lmsSettingService.getConnectionHealth(instituteId));
    }

    /**
     * "Use this LMS for this course": writes the per-course LMS key from a chosen institute
     * connection + courseId, and optionally attaches an existing enrolment workflow to the
     * course's package sessions.
     */
    @PostMapping("/apply-connection-to-package")
    public ResponseEntity<Map<String, Object>> applyConnectionToPackage(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId,
            @RequestParam("packageId") String packageId,
            @RequestBody ApplyLmsConnectionRequest request) {
        // Prefer the multi-select workflowIds; fall back to the deprecated single workflowId.
        java.util.List<String> workflowIds = request.getWorkflowIds();
        if ((workflowIds == null || workflowIds.isEmpty())
                && request.getWorkflowId() != null && !request.getWorkflowId().isBlank()) {
            workflowIds = java.util.List.of(request.getWorkflowId());
        }
        return ResponseEntity.ok(lmsSettingService.applyConnectionToPackage(
                instituteId, packageId, request.getConnectionId(), request.getCourseId(),
                workflowIds, request.getExtraFields()));
    }

    /**
     * The enrolment workflow already attached to this course (via workflow_trigger rows whose
     * event_id is one of the course's package sessions), so the course LMS card can pre-select it.
     */
    @GetMapping("/package-attached-workflow")
    public ResponseEntity<Map<String, Object>> packageAttachedWorkflow(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("packageId") String packageId) {
        return ResponseEntity.ok(lmsSettingService.getAttachedEnrollmentWorkflow(packageId));
    }

    /** All workflow triggers (any event) attached to this course. */
    @GetMapping("/package-workflow-triggers")
    public ResponseEntity<List<PackageTriggerDTO>> getPackageWorkflowTriggers(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("packageId") String packageId) {
        return ResponseEntity.ok(lmsSettingService.getPackageWorkflowTriggers(packageId));
    }

    /**
     * Save (authoritative) the course's workflow triggers: each {triggerEventName, workflowId} pair
     * is attached to all the course's package sessions; pairs no longer listed are detached.
     */
    @PostMapping("/package-workflow-triggers")
    public ResponseEntity<Map<String, Object>> savePackageWorkflowTriggers(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId,
            @RequestParam("packageId") String packageId,
            @RequestBody List<PackageTriggerDTO> triggers) {
        return ResponseEntity.ok(lmsSettingService.savePackageWorkflowTriggers(instituteId, packageId, triggers));
    }
}
