package vacademy.io.admin_core_service.features.audience.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.audience.dto.BulkLeadStatusRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.BulkLeadStatusResponseDTO;
import vacademy.io.admin_core_service.features.audience.dto.LeadStatusDTO;
import vacademy.io.admin_core_service.features.audience.service.BulkLeadStatusService;
import vacademy.io.admin_core_service.features.audience.service.LeadStatusService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.stream.Collectors;

/**
 * CRUD for the per-institute lead status catalog, plus setting a lead's current status.
 * Replaces the customStatuses that previously lived in the LEAD_SETTING JSON.
 */
@RestController
@RequestMapping("/admin-core-service/v1/lead-status")
@RequiredArgsConstructor
public class LeadStatusController {

    private final LeadStatusService leadStatusService;
    private final BulkLeadStatusService bulkLeadStatusService;

    /** List the institute's statuses (seeds the starter set on first access). */
    @GetMapping
    public ResponseEntity<List<LeadStatusDTO>> list(@RequestParam String instituteId) {
        List<LeadStatusDTO> dtos = leadStatusService.listForInstitute(instituteId).stream()
                .map(LeadStatusDTO::from)
                .collect(Collectors.toList());
        return ResponseEntity.ok(dtos);
    }

    @PostMapping
    @Auditable(
            entityType = "LEAD_STATUS",
            action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'created lead status ' + (#dto?.label ?: #dto?.statusKey)")
    public ResponseEntity<LeadStatusDTO> create(@RequestParam String instituteId,
                                                @RequestBody LeadStatusDTO dto,
                                                @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(LeadStatusDTO.from(leadStatusService.create(instituteId, dto, user != null ? user.getUserId() : null)));
    }

    @PutMapping("/{id}")
    @Auditable(
            entityType = "LEAD_STATUS",
            action = "UPDATE",
            entityIdExpr = "#id",
            captureBefore = "@crmAuditNarrator.leadStatusSnapshot(#id)",
            descriptionExpr = "'updated lead status ' + (#dto?.label "
                    + "?: @crmAuditNarrator.nameFromSnapshot(#before, #id))")
    public ResponseEntity<LeadStatusDTO> update(@PathVariable String id,
                                                @RequestBody LeadStatusDTO dto,
                                                @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(LeadStatusDTO.from(leadStatusService.update(id, dto, user != null ? user.getUserId() : null)));
    }

    @DeleteMapping("/{id}")
    @Auditable(
            entityType = "LEAD_STATUS",
            action = "DELETE",
            entityIdExpr = "#id",
            captureBefore = "@crmAuditNarrator.leadStatusSnapshot(#id)",
            descriptionExpr = "'deleted lead status ' + @crmAuditNarrator.nameFromSnapshot(#before, #id)")
    public ResponseEntity<Void> delete(@PathVariable String id,
                                       @RequestAttribute("user") CustomUserDetails user) {
        leadStatusService.deactivate(id, user != null ? user.getUserId() : null);
        return ResponseEntity.ok().build();
    }

    /** Set a lead's current status (manual change from the leads UI). */
    @PostMapping("/lead/{audienceResponseId}")
    @Auditable(
            entityType = "LEAD",
            action = "STATUS_CHANGE",
            entityIdExpr = "#audienceResponseId",
            descriptionExpr = "'changed lead status of ' + @crmAuditNarrator.leadFor(#audienceResponseId) "
                    + "+ ' to ' + @crmAuditNarrator.leadStatusFor(#statusId)")
    public ResponseEntity<String> setLeadStatus(@PathVariable String audienceResponseId,
                                                @RequestParam String statusId,
                                                @RequestParam(required = false, defaultValue = "MANUAL") String source,
                                                @RequestAttribute("user") CustomUserDetails user) {
        leadStatusService.changeLeadStatus(audienceResponseId, statusId,
                user != null ? user.getUserId() : null, source);
        return ResponseEntity.ok("Lead status updated");
    }

    /**
     * Set the status of MANY leads at once — the "Change status" entry in the leads list's
     * Bulk actions menu. Body-based because the selection is an id list that bulk-select
     * across pages can grow to thousands.
     *
     * <p>Runs the same per-lead path as {@link #setLeadStatus}, so history, the timeline entry,
     * LEAD_STATUS_CHANGED and the conversion_status mirror all happen per lead. Access matches
     * the single-lead endpoint (any caller who can see the lead can restatus it) — bulk is not
     * admin-gated the way delete and move are, because changing status is a counsellor's normal
     * daily action.</p>
     *
     * <p>Returns per-bucket counts; partial success is expected, not an error.</p>
     */
    @PostMapping("/leads/bulk")
    @Auditable(
            entityType = "LEAD",
            action = "STATUS_CHANGE",
            entityIdExpr = "#request?.responseIds != null and #request.responseIds.size() == 1 "
                    + "? #request.responseIds[0] : null",
            // A bulk change where every lead was already on the target status moved nothing;
            // logging it would claim statuses changed that never did.
            conditionExpr = "#result?.body != null and #result.body.updated > 0",
            descriptionExpr = "'changed lead status of ' + @crmAuditNarrator.leadsFor(#request?.responseIds) "
                    + "+ ' to ' + @crmAuditNarrator.leadStatusFor(#request?.statusId)")
    public ResponseEntity<BulkLeadStatusResponseDTO> setLeadStatusBulk(
            @RequestBody BulkLeadStatusRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(bulkLeadStatusService.changeStatusBulk(request, user));
    }
}
