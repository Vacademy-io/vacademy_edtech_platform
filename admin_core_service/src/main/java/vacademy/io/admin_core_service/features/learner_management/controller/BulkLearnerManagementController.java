package vacademy.io.admin_core_service.features.learner_management.controller;

import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountPermissionService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkAssignRequestDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkAssignResponseDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkDeassignRequestDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkDeassignResponseDTO;
import vacademy.io.admin_core_service.features.learner_management.service.BulkAssignmentService;
import vacademy.io.admin_core_service.features.learner_management.service.BulkDeassignmentService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * v3 Bulk Learner Management API.
 * <p>
 * - POST /assign — Assign N users to M package sessions
 * - POST /deassign — De-assign N users from M package sessions
 * <p>
 * Both endpoints support dry-run mode for preview.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/v3/learner-management")
@RequiredArgsConstructor
public class BulkLearnerManagementController {

    private final BulkAssignmentService bulkAssignmentService;
    private final BulkDeassignmentService bulkDeassignmentService;
    private final AdminDiscountPermissionService adminDiscountPermissionService;

    /**
     * Bulk assign users to multiple package sessions.
     * <p>
     * Supports:
     * - Explicit user_ids or filter-based selection
     * - Per-assignment invite/plan/access config with auto-resolution
     * - Duplicate handling: SKIP / ERROR / RE_ENROLL
     * - dry_run mode for preview
     */
    // conditionExpr: this endpoint returns 200 without mutating anything on a
    // dry-run preview, or when every item was skipped/failed. Auditing those
    // would claim enrollments that never happened.
    @PostMapping("/assign")
    @Auditable(
            entityType = "LEARNER",
            action = "ENROLL",
            conditionExpr = "#result?.body != null and !#result.body.dryRun "
                    + "and (#result.body.summary?.successful ?: 0) > 0",
            descriptionExpr = "@auditNarrator.bulkAssignmentOf(#result?.body?.summary?.successful, "
                    + "#request?.userIds, #request?.assignments?.![packageSessionId])")
    public ResponseEntity<BulkAssignResponseDTO> bulkAssign(
            @RequestBody BulkAssignRequestDTO request,
            @AuthenticationPrincipal CustomUserDetails userDetails) {

        log.info("Bulk assign request: instituteId={}, users={}, assignments={}, dryRun={}, admin={}",
                request.getInstituteId(),
                request.getUserIds() != null ? request.getUserIds().size() : 0,
                request.getAssignments() != null ? request.getAssignments().size() : 0,
                request.getOptions() != null && request.getOptions().isDryRun(),
                userDetails != null ? userDetails.getUserId() : "unknown");

        // Only roles allowed to by Display Settings (learnerManagement.canApplyDiscounts).
        boolean discountRequested = request.getAssignments() != null && request.getAssignments().stream()
                .anyMatch(a -> AdminDiscountService.isRequested(a.getAdminDiscount()));
        if (discountRequested) {
            adminDiscountPermissionService.requireCanApplyDiscounts(userDetails, request.getInstituteId());
        }

        String adminUserId = userDetails != null ? userDetails.getUserId() : null;
        BulkAssignResponseDTO response = bulkAssignmentService.bulkAssign(request, adminUserId);

        log.info("Bulk assign complete: total={}, success={}, failed={}, skipped={}, reEnrolled={}, dryRun={}",
                response.getSummary().getTotalRequested(),
                response.getSummary().getSuccessful(),
                response.getSummary().getFailed(),
                response.getSummary().getSkipped(),
                response.getSummary().getReEnrolled(),
                response.isDryRun());

        return ResponseEntity.ok(response);
    }

    /**
     * Bulk de-assign users from multiple package sessions.
     * <p>
     * Supports:
     * - Explicit user_ids or filter-based selection
     * - SOFT cancel (access until expiry) or HARD terminate (immediate revocation)
     * - Shared UserPlan warnings
     * - dry_run mode for preview
     */
    // A HARD de-assign revokes access immediately (a termination); SOFT leaves
    // access until expiry. The action follows the request's own mode.
    @PostMapping("/deassign")
    @Auditable(
            entityType = "LEARNER",
            actionExpr = "#request?.options?.mode == 'HARD' ? 'TERMINATE' : 'CANCEL'",
            conditionExpr = "#result?.body != null and !#result.body.dryRun "
                    + "and (#result.body.summary?.successful ?: 0) > 0",
            descriptionExpr = "@auditNarrator.bulkDeassignmentOf(#request?.options?.mode, "
                    + "#result?.body?.summary?.successful, #request?.userIds, #request?.packageSessionIds, "
                    + "#request?.options?.reason)")
    public ResponseEntity<BulkDeassignResponseDTO> bulkDeassign(
            @RequestBody BulkDeassignRequestDTO request,
            @AuthenticationPrincipal CustomUserDetails userDetails) {

        log.info("Bulk deassign request: instituteId={}, users={}, packageSessions={}, dryRun={}, admin={}",
                request.getInstituteId(),
                request.getUserIds() != null ? request.getUserIds().size() : 0,
                request.getPackageSessionIds() != null ? request.getPackageSessionIds().size() : 0,
                request.getOptions() != null && request.getOptions().isDryRun(),
                userDetails != null ? userDetails.getUserId() : "unknown");

        String adminUserId = userDetails != null ? userDetails.getUserId() : null;
        BulkDeassignResponseDTO response = bulkDeassignmentService.bulkDeassign(request, adminUserId);

        log.info("Bulk deassign complete: total={}, success={}, failed={}, skipped={}, dryRun={}",
                response.getSummary().getTotalRequested(),
                response.getSummary().getSuccessful(),
                response.getSummary().getFailed(),
                response.getSummary().getSkipped(),
                response.isDryRun());

        return ResponseEntity.ok(response);
    }
}
