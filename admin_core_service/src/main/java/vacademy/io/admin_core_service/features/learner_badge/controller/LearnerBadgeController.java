package vacademy.io.admin_core_service.features.learner_badge.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.learner_badge.dto.AwardBadgeRequest;
import vacademy.io.admin_core_service.features.learner_badge.dto.AwardBadgeResponse;
import vacademy.io.admin_core_service.features.learner_badge.dto.BadgeDefinitionRequest;
import vacademy.io.admin_core_service.features.learner_badge.dto.CatalogueBadgeResponse;
import vacademy.io.admin_core_service.features.learner_badge.dto.LearnerBadgeDTO;
import vacademy.io.admin_core_service.features.learner_badge.dto.SyncUnlocksRequest;
import vacademy.io.admin_core_service.features.learner_badge.service.BadgeCatalogueService;
import vacademy.io.admin_core_service.features.learner_badge.service.LearnerBadgeService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * Learner badges: staff awards, revokes and the per-learner list; the learner's own list
 * and auto-unlock sync; and a server-side catalogue append.
 *
 * <p>Authorization: the staff endpoints require institute membership with a staff role
 * ({@link InstituteAccessValidator#requireStaffAccess}); creating a catalogue badge is
 * institute-admin only. The learner endpoints take the learner from the JWT and the sync
 * additionally proves enrollment in the institute inside the service.
 */
@RestController
@RequestMapping("/admin-core-service/learner-badge")
@RequiredArgsConstructor
@Slf4j
public class LearnerBadgeController {

    private final LearnerBadgeService learnerBadgeService;
    private final BadgeCatalogueService badgeCatalogueService;
    private final InstituteAccessValidator instituteAccessValidator;

    /** Staff: award a configured badge to one or more learners (one transaction, one batched notification). */
    @PostMapping("/institutes/{instituteId}/award")
    @Auditable(
            entityType = "LEARNER_BADGE",
            action = "AWARD",
            entityIdExpr = "#request?.badgeId",
            descriptionExpr = "'awarded badge ' + (#request?.badgeName ?: #request?.badgeId) + ' to ' "
                    + "+ (#request?.userIds?.size() ?: 0) + ' learner(s)'")
    public ResponseEntity<AwardBadgeResponse> award(
            @PathVariable String instituteId,
            @Valid @RequestBody AwardBadgeRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        AwardBadgeResponse response;
        try {
            response = learnerBadgeService.award(request, instituteId, user.getUserId(), user.getFullName());
        } catch (DataIntegrityViolationException raced) {
            // A learner's sync-unlocks inserted the same (user, badge) between our read and our
            // commit (award() commits in its own transaction, so the violation surfaces HERE).
            // One re-run finds that row and records the award as an upgrade instead.
            log.info("Badge award for institute {} raced a concurrent insert; retrying once ({})",
                    instituteId, raced.getMostSpecificCause().getMessage());
            response = learnerBadgeService.award(request, instituteId, user.getUserId(), user.getFullName());
        }
        return ResponseEntity.ok(response);
    }

    /** Staff: revoke a learner's active award for a badge, either source (kept for audit, status -> REVOKED). */
    @PostMapping("/institutes/{instituteId}/revoke")
    @Auditable(
            entityType = "LEARNER_BADGE",
            action = "REVOKE",
            entityIdExpr = "#badgeId",
            descriptionExpr = "'revoked badge ' + #badgeId + ' from learner ' + #userId",
            // SpEL has no null-safe indexer (`?[` is the selection operator), hence the explicit guard.
            conditionExpr = "#result?.body != null and #result.body['revoked'] == true")
    public ResponseEntity<Map<String, Boolean>> revoke(
            @PathVariable String instituteId,
            @RequestParam String userId,
            @RequestParam String badgeId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        boolean revoked = learnerBadgeService.revoke(userId, badgeId, instituteId, user.getUserId());
        return ResponseEntity.ok(Map.of("revoked", revoked));
    }

    /** Staff: list a learner's active awarded badges (for the student detail "Badges" tab). */
    @GetMapping("/institutes/{instituteId}/users/{userId}")
    public ResponseEntity<List<LearnerBadgeDTO>> getUserAwardedBadges(
            @PathVariable String instituteId,
            @PathVariable String userId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(learnerBadgeService.getActiveAwardsForUser(userId, instituteId));
    }

    /**
     * Institute admin: append ONE badge to the institute's catalogue (or replace one by id)
     * without re-saving the whole BADGES_REWARDS_SETTING blob from client state.
     */
    @PostMapping("/institutes/{instituteId}/catalogue")
    @Auditable(
            entityType = "LEARNER_BADGE",
            action = "CREATE",
            entityIdExpr = "#result?.body?.badge?.id",
            descriptionExpr = "'created badge ' + (#request?.name ?: '')")
    public ResponseEntity<CatalogueBadgeResponse> createCatalogueBadge(
            @PathVariable String instituteId,
            @Valid @RequestBody BadgeDefinitionRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireAdminAccess(user, instituteId);
        return ResponseEntity.ok(badgeCatalogueService.upsert(instituteId, request));
    }

    /** Learner: list the authenticated learner's own active awarded badges. */
    @GetMapping("/learner/v1/my-badges")
    public ResponseEntity<List<LearnerBadgeDTO>> getMyAwardedBadges(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerBadgeService.getActiveAwardsForUser(user.getUserId(), instituteId));
    }

    /**
     * Learner: persist the authenticated learner's client-computed auto-unlock badges so
     * they appear on the in-app and public leaderboards. The learner is ALWAYS taken from
     * the JWT (never the body), so a caller cannot sync badges for anyone else; the service
     * further requires enrollment in the institute and validates every badge id against
     * the institute's catalogue.
     */
    @PostMapping("/learner/v1/sync-unlocks")
    public ResponseEntity<Map<String, Integer>> syncUnlocks(
            @Valid @RequestBody SyncUnlocksRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        int synced = learnerBadgeService.syncAutoUnlocks(
                user.getUserId(), request.getInstituteId(), request.getBadges());
        return ResponseEntity.ok(Map.of("synced", synced));
    }
}
