package vacademy.io.admin_core_service.features.counselor_pool.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.admin_core_service.features.counselor_pool.dto.*;
import vacademy.io.admin_core_service.features.counselor_pool.service.CounselorPoolService;
import vacademy.io.admin_core_service.features.counselor_pool.service.CounselorPoolShiftService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Admin endpoints for managing counselor pools, their audiences, members,
 * and weekly shift schedules. The actual lead-time routing engine
 * (CounselorAssignmentService) is invoked from the lead submit flow, not
 * from these endpoints.
 */
@RestController
@RequestMapping("/admin-core-service/v1/counselor-pool")
@RequiredArgsConstructor
public class CounselorPoolController {

    private final CounselorPoolService poolService;
    private final CounselorPoolShiftService shiftService;

    // ────────────────────────────────────────────────────────────────
    // Pool CRUD
    // ────────────────────────────────────────────────────────────────

    @PostMapping
    @Auditable(
            entityType = "COUNSELLOR_POOL",
            action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'created counsellor pool ' + (#result?.body?.name ?: '')")
    public ResponseEntity<CounselorPoolDTO> createPool(
            @RequestBody CreatePoolRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(poolService.createPool(request, user.getUserId()));
    }

    @GetMapping
    public ResponseEntity<List<CounselorPoolDTO>> listPools(@RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(poolService.listPools(instituteId));
    }

    /**
     * Which pool (if any) a single lead list feeds — powers the pool chip in the lead
     * list's header, so an admin opening a list can see where its leads get routed
     * without going to Pools and reading every pool's audience tab.
     *
     * <p>An audience belongs to at most ONE pool ({@code existsByAudienceId} blocks a
     * second at pool create/update time), so this returns a single object. 204 when the
     * list is not attached to a pool, which is the normal state for lists that are not
     * auto-assigned.</p>
     */
    @GetMapping("/by-audience/{audienceId}")
    public ResponseEntity<CounselorPoolDTO> getPoolForAudience(@PathVariable String audienceId) {
        return poolService.findPoolForAudience(audienceId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @GetMapping("/{poolId}")
    public ResponseEntity<CounselorPoolDTO> getPool(@PathVariable String poolId) {
        return ResponseEntity.ok(poolService.getPool(poolId));
    }

    @PatchMapping("/{poolId}")
    @Auditable(
            entityType = "COUNSELLOR_POOL",
            action = "UPDATE",
            entityIdExpr = "#poolId",
            descriptionExpr = "'updated counsellor pool ' + (#result?.body?.name ?: #poolId)")
    public ResponseEntity<CounselorPoolDTO> updatePool(
            @PathVariable String poolId,
            @RequestBody UpdatePoolRequest request) {
        return ResponseEntity.ok(poolService.updatePool(poolId, request));
    }

    @DeleteMapping("/{poolId}")
    @Auditable(
            entityType = "COUNSELLOR_POOL",
            action = "DELETE",
            entityIdExpr = "#poolId",
            descriptionExpr = "'deleted a counsellor pool'")
    public ResponseEntity<String> deletePool(@PathVariable String poolId) {
        poolService.deletePool(poolId);
        return ResponseEntity.ok("Pool deleted");
    }

    // ────────────────────────────────────────────────────────────────
    // Audience attachment
    // ────────────────────────────────────────────────────────────────

    /**
     * Attach one or more audiences (campaigns) to the pool atomically.
     * Body: { audience_ids: [...] }. If any id fails, nothing is added.
     */
    @PostMapping("/{poolId}/audiences")
    public ResponseEntity<String> addAudiencesToPool(
            @PathVariable String poolId,
            @RequestBody AddAudiencesRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        poolService.addAudiencesToPool(poolId, request.getAudienceIds(), user.getUserId());
        return ResponseEntity.ok("Audiences attached");
    }

    @DeleteMapping("/{poolId}/audiences/{audienceId}")
    public ResponseEntity<String> removeAudienceFromPool(
            @PathVariable String poolId,
            @PathVariable String audienceId) {
        poolService.removeAudienceFromPool(poolId, audienceId);
        return ResponseEntity.ok("Audience detached");
    }

    /**
     * Replace the rotation order of counselors for one (pool, audience) pair.
     * Body: { counselor_user_ids: [..., ..., ...] } in the desired rotation order.
     * The backend assigns display_order = 1..N based on list position.
     */
    @PutMapping("/{poolId}/audiences/{audienceId}/order")
    public ResponseEntity<String> updateAudienceOrder(
            @PathVariable String poolId,
            @PathVariable String audienceId,
            @RequestBody UpdateAudienceOrderRequest request) {
        poolService.updateAudienceMemberOrder(poolId, audienceId, request.getCounselorUserIds());
        return ResponseEntity.ok("Order updated");
    }

    /**
     * When this list hands out a counsellor. Body: { assign_on_intake: true|false }.
     * false = AI-first: leave new leads unowned so the AI call runs, assign only once the
     * call outcome (or the exhausted-retries hand-off) asks for a counsellor.
     */
    @PatchMapping("/{poolId}/audiences/{audienceId}/assignment")
    public ResponseEntity<String> updateAudienceAssignment(
            @PathVariable String poolId,
            @PathVariable String audienceId,
            @RequestBody UpdateAudienceAssignmentRequest request) {
        if (request == null || request.getAssignOnIntake() == null) {
            throw new VacademyException("assign_on_intake is required");
        }
        poolService.updateAudienceAssignOnIntake(poolId, audienceId, request.getAssignOnIntake());
        return ResponseEntity.ok("Assignment timing updated");
    }

    // ────────────────────────────────────────────────────────────────
    // Counselor (member) management
    // ────────────────────────────────────────────────────────────────

    /**
     * Add one or more counselors to the pool atomically.
     * Body: { counselor_user_ids: [...] }. If any id fails, nothing is added.
     */
    @PostMapping("/{poolId}/counselors")
    @Auditable(
            entityType = "COUNSELLOR_POOL",
            action = "ADD_MEMBER",
            entityIdExpr = "#poolId",
            descriptionExpr = "'added ' + @crmAuditNarrator.peopleFor(#request?.counselorUserIds) + ' to a counsellor pool'")
    public ResponseEntity<String> addCounselorsToPool(
            @PathVariable String poolId,
            @RequestBody AddCounselorsRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        poolService.addCounselorsToPool(poolId, request.getCounselorUserIds(), user.getUserId());
        return ResponseEntity.ok("Counselors added to pool");
    }

    @DeleteMapping("/{poolId}/counselors/{counselorUserId}")
    @Auditable(
            entityType = "COUNSELLOR_POOL",
            action = "REMOVE_MEMBER",
            entityIdExpr = "#poolId",
            descriptionExpr = "'removed ' + @crmAuditNarrator.personFor(#counselorUserId) + ' from a counsellor pool'")
    public ResponseEntity<String> removeCounselorFromPool(
            @PathVariable String poolId,
            @PathVariable String counselorUserId) {
        poolService.removeCounselorFromPool(poolId, counselorUserId);
        return ResponseEntity.ok("Counselor removed from pool");
    }

    /**
     * Flip a counselor's status across all audiences in this pool. When marking
     * INACTIVE, the request body must include backup_counselor_user_id. The
     * acting admin is forwarded to the service so any per-lead reassign
     * (when reassign_existing_leads=true) logs the timeline event under the
     * right actor.
     */
    @PatchMapping("/{poolId}/counselors/{counselorUserId}/status")
    @Auditable(
            entityType = "COUNSELLOR_POOL",
            action = "MEMBER_STATUS_CHANGE",
            entityIdExpr = "#poolId",
            descriptionExpr = "'changed pool status of ' + @crmAuditNarrator.personFor(#counselorUserId) "
                    + "+ (#request?.status != null ? ' to ' + #request.status : '')")
    public ResponseEntity<String> updateMemberStatus(
            @PathVariable String poolId,
            @PathVariable String counselorUserId,
            @RequestBody UpdateMemberStatusRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        poolService.updateMemberStatus(poolId, counselorUserId, request, user);
        return ResponseEntity.ok("Status updated");
    }

    /**
     * List the pools (within the institute) where this counselor is currently
     * ACTIVE. Powers the multi-pool selector in the "Mark Inactive" dialog.
     * Pools where the counselor is already INACTIVE are excluded.
     */
    @GetMapping("/counselors/{counselorUserId}/memberships")
    public ResponseEntity<List<CounselorPoolMembershipDTO>> listCounselorMemberships(
            @PathVariable String counselorUserId,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(poolService.listActiveMembershipsForCounselor(instituteId, counselorUserId));
    }

    /**
     * Flip a counselor's status across MULTIPLE pools at once. All-or-nothing
     * — any per-pool failure rolls back the whole batch. Body carries the
     * pool_ids plus the same status/backup/reassign flag applied to each.
     * The acting admin is forwarded so per-lead reassign timeline events
     * record the right actor.
     */
    @PatchMapping("/counselors/{counselorUserId}/status-multi")
    public ResponseEntity<String> bulkUpdateMemberStatus(
            @PathVariable String counselorUserId,
            @RequestBody BulkUpdateMemberStatusRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        poolService.bulkUpdateMemberStatusAcrossPools(counselorUserId, request, user);
        return ResponseEntity.ok("Status updated");
    }

    /**
     * Set monthly_target per audience for one counsellor in this pool. Body
     * carries a list of {audience_id, monthly_target} entries — one per cell
     * of this counsellor's row in the audience × counsellor matrix. Null
     * targets clear the cell; non-null must be >= 0.
     */
    @PatchMapping("/{poolId}/counselors/{counselorUserId}/monthly-target")
    public ResponseEntity<String> updateMemberMonthlyTargets(
            @PathVariable String poolId,
            @PathVariable String counselorUserId,
            @RequestBody UpdateMemberMonthlyTargetsRequest request) {
        poolService.updateMemberMonthlyTargets(poolId, counselorUserId, request);
        return ResponseEntity.ok("Monthly targets updated");
    }

    // ────────────────────────────────────────────────────────────────
    // Weekly schedule (TIME_BASED mode)
    // ────────────────────────────────────────────────────────────────

    @GetMapping("/{poolId}/schedule")
    public ResponseEntity<List<PoolShiftDTO>> getWeeklySchedule(@PathVariable String poolId) {
        return ResponseEntity.ok(shiftService.getWeeklySchedule(poolId));
    }

    /**
     * Replace the entire weekly schedule. Validates 24/7 coverage across all
     * 7 days before any write. On any validation failure, no changes are
     * persisted.
     */
    @PutMapping("/{poolId}/schedule")
    public ResponseEntity<List<PoolShiftDTO>> setWeeklySchedule(
            @PathVariable String poolId,
            @RequestBody WeeklyScheduleRequest request) {
        return ResponseEntity.ok(shiftService.setWeeklySchedule(poolId, request));
    }
}
