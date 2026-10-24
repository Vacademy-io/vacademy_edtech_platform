package vacademy.io.admin_core_service.features.counsellor_target.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.counsellor_target.dto.BulkCounsellorTargetRequest;
import vacademy.io.admin_core_service.features.counsellor_target.dto.CounsellorTargetDTO;
import vacademy.io.admin_core_service.features.counsellor_target.dto.CounsellorTargetProgressDTO;
import vacademy.io.admin_core_service.features.counsellor_target.dto.CounsellorTargetProgressRequest;
import vacademy.io.admin_core_service.features.counsellor_target.dto.UpsertCounsellorTargetRequest;
import vacademy.io.admin_core_service.features.counsellor_target.service.CounsellorTargetService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.LeadWorkbenchSettingService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Per-counsellor targets for the Workbench dashboard. Targets themselves are
 * admin-set config (stored in the institute setting blob); "completed" is
 * computed live. Sits under the workbench base path so it shares the section.
 */
@RestController
@RequestMapping("/admin-core-service/v1/counsellor-workbench/targets")
@RequiredArgsConstructor
public class CounsellorTargetController {

    private final LeadWorkbenchSettingService settingService;
    private final CounsellorTargetService targetService;

    /** Target-vs-completed for a set of counsellors over the selected window. */
    @PostMapping("/progress")
    public ResponseEntity<CounsellorTargetProgressDTO> progress(
            @RequestBody CounsellorTargetProgressRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(targetService.getProgress(request, user.getUserId()));
    }

    /** One counsellor's configured targets (settings dialog / drawer). */
    @GetMapping
    public ResponseEntity<List<CounsellorTargetDTO>> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("counsellorUserId") String counsellorUserId) {
        return ResponseEntity.ok(settingService.getTargets(instituteId, counsellorUserId));
    }

    /** Set/replace one counsellor's target for a (metric, period) slot. */
    @PutMapping
    @Auditable(
            entityType = "COUNSELLOR_TARGET",
            action = "UPDATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'set a target for ' + @crmAuditNarrator.personFor(#request?.counsellorUserId)")
    public ResponseEntity<CounsellorTargetDTO> upsert(@RequestBody UpsertCounsellorTargetRequest request) {
        return ResponseEntity.ok(settingService.upsertTarget(request));
    }

    /** Apply the same target to many counsellors (bulk-apply to a team). */
    @PostMapping("/bulk")
    @Auditable(
            entityType = "COUNSELLOR_TARGET",
            action = "BULK_UPDATE",
            descriptionExpr = "'set targets for ' + @crmAuditNarrator.peopleFor(#request?.counsellorUserIds)")
    public ResponseEntity<Void> bulk(@RequestBody BulkCounsellorTargetRequest request) {
        settingService.bulkUpsertTargets(request);
        return ResponseEntity.ok().build();
    }

    /** Remove one target by id. */
    @DeleteMapping("/{targetId}")
    @Auditable(
            entityType = "COUNSELLOR_TARGET",
            action = "DELETE",
            entityIdExpr = "#targetId",
            descriptionExpr = "'removed a target for ' + @crmAuditNarrator.personFor(#counsellorUserId)")
    public ResponseEntity<Void> delete(
            @PathVariable String targetId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam("counsellorUserId") String counsellorUserId) {
        settingService.deleteTarget(instituteId, counsellorUserId, targetId);
        return ResponseEntity.ok().build();
    }
}
