package vacademy.io.admin_core_service.features.counsellor_workbench.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.counsellor_workbench.dto.*;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorReassignService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorWorkbenchService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.LeadWorkbenchSettingService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.WorkbenchConfig;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.util.List;

/**
 * Counsellor-facing workbench endpoints.
 *
 * RBAC model: counsellors are role-defined (COUNSELLOR in auth_service) —
 * nothing is configured. /me/* resolve the caller's hierarchy scope (self +
 * counsellor-role users below them through parent_user_id chains in any team
 * they belong to); pure admins see the institute-wide counsellor roster.
 */
@RestController
@RequestMapping("/admin-core-service/v1/counsellor-workbench")
@RequiredArgsConstructor
public class CounsellorWorkbenchController {

    private final CounsellorWorkbenchService workbenchService;
    private final CounsellorReassignService reassignService;
    private final LeadWorkbenchSettingService configService;

    // ────────────────────────────────────────────────────────────────
    // Config (rating strategy — the old leads_team_id config is gone;
    // counsellors are role-defined and scope comes from the org hierarchy)
    // ────────────────────────────────────────────────────────────────

    @GetMapping("/config")
    public ResponseEntity<WorkbenchConfig> getConfig(@RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(configService.get(instituteId));
    }

    /**
     * Upsert of the rating-strategy config. Old frontends that still PUT a
     * {@code leads_team_id} get it silently ignored (the field no longer
     * exists on {@link WorkbenchConfig} and Jackson skips unknown properties).
     */
    @PutMapping("/config")
    @Auditable(
            entityType = "COUNSELLOR_WORKBENCH_CONFIG",
            action = "UPDATE",
            descriptionExpr = "'updated counsellor workbench settings'")
    public ResponseEntity<WorkbenchConfig> updateConfig(@RequestBody WorkbenchConfig request) {
        boolean hasRatingFields = request.getStrategyType() != null
                || request.getStartingRating() != null
                || request.getWindowDays() != null
                || request.getSuccessStatusKeys() != null
                || request.getWConversion() != null
                || request.getWVelocity() != null
                || request.getIdealVelocityHours() != null
                || request.getWorstVelocityHours() != null
                || request.getMinSampleSize() != null;
        if (hasRatingFields) {
            configService.upsertRatingStrategy(request);
        }
        return ResponseEntity.ok(configService.get(request.getInstituteId()));
    }

    // ────────────────────────────────────────────────────────────────
    // Me
    // ────────────────────────────────────────────────────────────────

    @GetMapping("/me/team")
    public ResponseEntity<WorkbenchTeamDTO> myTeam(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(workbenchService.myTeam(instituteId, user));
    }

    @GetMapping("/me/leads")
    public ResponseEntity<Page<WorkbenchLeadDTO>> myLeads(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(workbenchService.myLeads(instituteId, user, status, page, size));
    }

    // ────────────────────────────────────────────────────────────────
    // Roster
    // ────────────────────────────────────────────────────────────────

    /**
     * The workbench roster: every COUNSELLOR-role user the caller may see —
     * hierarchy scope for scoped callers, institute-wide for pure admins.
     * {@code assignable=true} resolves the ASSIGNMENT-target set instead
     * (ADMIN-role callers get the institute-wide roster even when they also
     * hold COUNSELLOR) — powers the reassign dialog's target dropdown.
     */
    @GetMapping("/counsellors")
    public ResponseEntity<Page<WorkbenchCounsellorDTO>> listCounsellors(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size,
            @RequestParam(value = "assignable", defaultValue = "false") boolean assignable,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(workbenchService.listCounsellors(
                instituteId, search, status, page, size, user, assignable));
    }

    /**
     * @deprecated the roster is role-based now; teamId is ignored. Kept so an
     * old frontend keeps working during rollout — use {@code GET /counsellors}.
     */
    @Deprecated
    @GetMapping("/team/{teamId}/counsellors")
    public ResponseEntity<Page<WorkbenchCounsellorDTO>> listCounsellorsForTeam(
            @PathVariable String teamId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(workbenchService.listCounsellorsForTeam(
                instituteId, teamId, search, status, page, size, user));
    }

    /**
     * Leads currently assigned to a specific counsellor. The CSO / manager
     * detail drawer hits this when opening someone else's profile — the
     * /me/leads endpoint is auth-scoped to the caller so it can't surface
     * another counsellor's leads. Hierarchy-scoped callers can only open
     * users inside their own scope.
     */
    @GetMapping("/counsellors/{userId}/leads")
    public ResponseEntity<Page<WorkbenchLeadDTO>> counsellorLeads(
            @PathVariable String userId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(workbenchService.leadsForCounsellor(instituteId, userId, status, page, size, user));
    }

    // ────────────────────────────────────────────────────────────────
    // Counsellor status flip
    // ────────────────────────────────────────────────────────────────

    @PatchMapping("/counsellors/{userId}/status")
    @Auditable(
            entityType = "COUNSELLOR",
            action = "STATUS_CHANGE",
            entityIdExpr = "#userId",
            descriptionExpr = "'changed status of counsellor ' + @crmAuditNarrator.personFor(#userId) "
                    + "+ (#request?.status != null ? ' to ' + #request.status : '')")
    public ResponseEntity<StatusChangeResponseDTO> setStatus(
            @PathVariable String userId,
            @RequestBody SetStatusRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(
                workbenchService.setStatus(request.getInstituteId(), userId, request.getStatus(), user));
    }

    // ────────────────────────────────────────────────────────────────
    // Reassign
    // ────────────────────────────────────────────────────────────────

    @PostMapping("/reassign/preview")
    public ResponseEntity<ReassignResultDTO> previewReassign(
            @RequestBody ReassignRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(reassignService.preview(request, user));
    }

    @PostMapping("/reassign")
    @Auditable(
            entityType = "LEAD",
            action = "REASSIGN",
            // The same service also serves /reassign/preview; a dry run moved
            // nothing and must not be recorded as if it had.
            conditionExpr = "#result?.body?.dryRun != true",
            descriptionExpr = "'reassigned ' + (#result?.body?.totalLeads ?: 0) + ' lead(s) from ' "
                    + "+ @crmAuditNarrator.personFor(#request?.fromUserId) "
                    + "+ (#request?.targetUserId != null ? ' to ' "
                    + "+ @crmAuditNarrator.personFor(#request.targetUserId) : '')")
    public ResponseEntity<ReassignResultDTO> reassign(
            @RequestBody ReassignRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(reassignService.reassign(request, user));
    }

    // ────────────────────────────────────────────────────────────────
    // Bulk assign (multi-selected leads from the leads / campaign-users list)
    // ────────────────────────────────────────────────────────────────

    @PostMapping("/assign/preview")
    public ResponseEntity<AssignLeadsResultDTO> previewAssign(
            @RequestBody AssignLeadsRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(reassignService.assignPreview(request, user));
    }

    @PostMapping("/assign")
    @Auditable(
            entityType = "LEAD",
            action = "ASSIGN",
            conditionExpr = "#result?.body?.dryRun != true",
            descriptionExpr = "'assigned ' + (#result?.body?.totalLeads ?: 0) + ' lead(s)' "
                    + "+ (#request?.targetUserId != null ? ' to ' "
                    + "+ @crmAuditNarrator.personFor(#request.targetUserId) : '')")
    public ResponseEntity<AssignLeadsResultDTO> assign(
            @RequestBody AssignLeadsRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(reassignService.assign(request, user));
    }

    // ────────────────────────────────────────────────────────────────
    // Activity feed
    // ────────────────────────────────────────────────────────────────

    @GetMapping("/counsellors/{userId}/activity")
    public ResponseEntity<List<ActivityFeedItemDTO>> activity(
            @PathVariable String userId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "from", required = false) Long fromMillis,
            @RequestParam(value = "to", required = false) Long toMillis,
            @RequestParam(value = "limit", defaultValue = "50") int limit,
            @RequestAttribute("user") CustomUserDetails user) {
        Timestamp from = fromMillis != null ? new Timestamp(fromMillis) : null;
        Timestamp to = toMillis != null ? new Timestamp(toMillis) : null;
        return ResponseEntity.ok(workbenchService.activityFeed(userId, instituteId, from, to, limit, user));
    }

    // ────────────────────────────────────────────────────────────────
    // Per-lead transfer chain
    // ────────────────────────────────────────────────────────────────

    /**
     * Returns the counsellor-assignment chain for one lead, oldest first.
     * Powers the expand-row "transfer history" in the counsellor drawer's
     * Leads tab. RBAC: caller must have access to the lead's current
     * assignee (enforced in the service layer).
     *
     * The {@code leadUserId} path variable is the lead's user_id (same id
     * carried by {@link WorkbenchLeadDTO#getUserId()}), not the
     * user_lead_profile.id.
     */
    @GetMapping("/leads/{leadUserId}/transfers")
    public ResponseEntity<List<LeadTransferDTO>> leadTransfers(
            @PathVariable String leadUserId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(workbenchService.leadTransfers(instituteId, leadUserId, user));
    }
}
