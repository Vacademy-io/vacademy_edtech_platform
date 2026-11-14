package vacademy.io.admin_core_service.features.counselor_pool.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadAssignmentNotifier;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counselor_pool.dto.*;
import vacademy.io.admin_core_service.features.counselor_pool.entity.*;
import vacademy.io.admin_core_service.features.counselor_pool.enums.AssignmentMode;
import vacademy.io.admin_core_service.features.counselor_pool.enums.PoolStatus;
import vacademy.io.admin_core_service.features.counselor_pool.enums.SchedulePattern;
import vacademy.io.admin_core_service.features.counselor_pool.repository.*;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.stream.Collectors;

/**
 * CRUD operations for counselor pools — pool itself, its audiences, and its members.
 * Shift management lives in CounselorPoolShiftService.
 * Assignment-time logic (round-robin / time-based) lives in CounselorAssignmentService.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CounselorPoolService {

    private final CounselorPoolRepository poolRepository;
    private final CounselorPoolAudienceRepository poolAudienceRepository;
    private final CounselorPoolMemberRepository poolMemberRepository;
    private final CounselorPoolShiftRepository poolShiftRepository;
    private final CounselorPoolShiftMemberRepository poolShiftMemberRepository;
    private final UserLeadProfileRepository userLeadProfileRepository;
    private final UserLeadProfileService userLeadProfileService;
    private final TimelineEventService timelineEventService;
    private final AuthService authService;
    private final LeadAssignmentNotifier leadAssignmentNotifier;

    // ────────────────────────────────────────────────────────────────
    // Pool CRUD
    // ────────────────────────────────────────────────────────────────

    @Transactional
    public CounselorPoolDTO createPool(CreatePoolRequest request, String createdByUserId) {
        validateAssignmentMode(request.getAssignmentMode());
        requireNonBlank(request.getInstituteId(), "institute_id is required");
        requireNonBlank(request.getName(), "name is required");

        if (poolRepository.existsByInstituteIdAndNameIgnoreCase(request.getInstituteId(), request.getName())) {
            throw new VacademyException("A pool with this name already exists in the institute");
        }

        String schedulePattern = resolveSchedulePattern(request.getSchedulePattern());

        CounselorPool pool = CounselorPool.builder()
                .instituteId(request.getInstituteId())
                .name(request.getName())
                .description(request.getDescription())
                .assignmentMode(request.getAssignmentMode())
                .schedulePattern(schedulePattern)
                .shiftAware(Boolean.TRUE.equals(request.getShiftAware()))
                .createdBy(createdByUserId)
                .build();
        pool = poolRepository.save(pool);

        // Link audiences (if provided). Block if any is already in another pool.
        List<String> audienceIds = request.getAudienceIds() == null ? List.of() : request.getAudienceIds();
        for (String audienceId : audienceIds) {
            attachAudienceInternal(pool.getId(), audienceId);
        }

        // Add members (if provided). Order in the list seeds display_order.
        List<String> counselorIds = request.getCounselorUserIds() == null ? List.of() : request.getCounselorUserIds();
        for (int i = 0; i < counselorIds.size(); i++) {
            String counselorId = counselorIds.get(i);
            int displayOrder = i + 1;
            for (String audienceId : audienceIds) {
                createMemberRow(pool.getId(), audienceId, counselorId, displayOrder, createdByUserId);
            }
        }

        return getPool(pool.getId());
    }

    @Transactional
    public CounselorPoolDTO updatePool(String poolId, UpdatePoolRequest request) {
        CounselorPool pool = poolRepository.findById(poolId)
                .orElseThrow(() -> new VacademyException("Pool not found: " + poolId));

        if (request.getName() != null) {
            pool.setName(request.getName());
        }
        if (request.getDescription() != null) {
            pool.setDescription(request.getDescription());
        }
        if (request.getAssignmentMode() != null) {
            validateAssignmentMode(request.getAssignmentMode());
            pool.setAssignmentMode(request.getAssignmentMode());
        }
        if (request.getSchedulePattern() != null) {
            String newPattern = resolveSchedulePattern(request.getSchedulePattern());
            // Switching pattern with shifts already configured would silently break the
            // editor's "trust the column" load path. Force admin to clear the schedule first.
            if (!newPattern.equals(pool.getSchedulePattern())
                    && poolShiftRepository.findByPoolIdOrderByDayOfWeekAscStartTimeAsc(poolId).size() > 0) {
                throw new VacademyException("Cannot change schedule_pattern while shifts exist. Clear the schedule first.");
            }
            pool.setSchedulePattern(newPattern);
        }
        if (request.getShiftAware() != null) {
            pool.setShiftAware(request.getShiftAware());
        }
        if (request.getUnifiedRotationOrder() != null) {
            pool.setUnifiedRotationOrder(request.getUnifiedRotationOrder());
        }
        poolRepository.save(pool);

        return getPool(poolId);
    }

    @Transactional
    public void deletePool(String poolId) {
        if (!poolRepository.existsById(poolId)) {
            throw new VacademyException("Pool not found: " + poolId);
        }
        if (poolAudienceRepository.existsByPoolId(poolId)) {
            throw new VacademyException("Pool has audiences linked. Remove all audiences before deleting the pool.");
        }
        // Empty pool: cascade clean up members + shifts + shift members in app layer.
        List<CounselorPoolShift> shifts = poolShiftRepository.findByPoolIdOrderByDayOfWeekAscStartTimeAsc(poolId);
        if (!shifts.isEmpty()) {
            List<String> shiftIds = shifts.stream().map(CounselorPoolShift::getId).toList();
            poolShiftMemberRepository.deleteByShiftIdIn(shiftIds);
            poolShiftRepository.deleteByPoolId(poolId);
        }
        poolMemberRepository.deleteByPoolId(poolId);
        poolRepository.deleteById(poolId);
    }

    /**
     * The pool a single lead list feeds, or empty when it feeds none.
     *
     * <p>Reuses {@link #getPool} rather than mapping the entity here, so the chip in the
     * lead-list header shows exactly the pool the Pools screen shows — including its
     * members, which is what makes "who will pick these up" answerable from the list.</p>
     */
    @Transactional(readOnly = true)
    public Optional<CounselorPoolDTO> findPoolForAudience(String audienceId) {
        return poolAudienceRepository.findByAudienceId(audienceId)
                .map(CounselorPoolAudience::getPoolId)
                .flatMap(poolRepository::findById)
                .map(pool -> getPool(pool.getId()));
    }

    @Transactional(readOnly = true)
    public CounselorPoolDTO getPool(String poolId) {
        CounselorPool pool = poolRepository.findById(poolId)
                .orElseThrow(() -> new VacademyException("Pool not found: " + poolId));

        List<PoolAudienceDTO> audiences = poolAudienceRepository.findByPoolId(poolId).stream()
                .map(CounselorPoolService::toAudienceDTO).toList();

        List<PoolMemberDTO> members = poolMemberRepository.findByPoolId(poolId).stream()
                .map(CounselorPoolService::toMemberDTO).toList();

        List<CounselorPoolShift> shifts = poolShiftRepository.findByPoolIdOrderByDayOfWeekAscStartTimeAsc(poolId);
        List<String> shiftIds = shifts.stream().map(CounselorPoolShift::getId).toList();
        Map<String, List<PoolShiftMemberDTO>> shiftMembersByShiftId = shiftIds.isEmpty() ? Map.of() :
                poolShiftMemberRepository.findByShiftIdIn(shiftIds).stream()
                        .map(CounselorPoolService::toShiftMemberDTO)
                        .collect(Collectors.groupingBy(PoolShiftMemberDTO::getShiftId));

        List<PoolShiftDTO> shiftDTOs = shifts.stream().map(s -> {
            PoolShiftDTO dto = toShiftDTO(s);
            dto.setMembers(shiftMembersByShiftId.getOrDefault(s.getId(), List.of()));
            return dto;
        }).toList();

        return toPoolDTO(pool, audiences, members, shiftDTOs);
    }

    @Transactional(readOnly = true)
    public List<CounselorPoolDTO> listPools(String instituteId) {
        // The list view shows "N campaigns · M counselors" per card, so we need at least the
        // child rows hydrated. Shifts are skipped here (only used inside the detail view).
        // For institute-sized data (handful of pools, dozens of members), this is cheap.
        List<CounselorPool> pools = poolRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId);
        return pools.stream()
                .map(p -> {
                    List<PoolAudienceDTO> audiences = poolAudienceRepository.findByPoolId(p.getId())
                            .stream().map(CounselorPoolService::toAudienceDTO).toList();
                    List<PoolMemberDTO> members = poolMemberRepository.findByPoolId(p.getId())
                            .stream().map(CounselorPoolService::toMemberDTO).toList();
                    return toPoolDTO(p, audiences, members, null);
                })
                .toList();
    }

    // ────────────────────────────────────────────────────────────────
    // Audience membership
    // ────────────────────────────────────────────────────────────────

    /**
     * Attach one or more audiences to the pool atomically. If any id fails
     * (e.g. already attached to another pool), the whole batch rolls back.
     */
    @Transactional
    public void addAudiencesToPool(String poolId, List<String> audienceIds, String addedByUserId) {
        ensurePoolExists(poolId);
        if (audienceIds == null || audienceIds.isEmpty()) {
            throw new VacademyException("audience_ids must be a non-empty list");
        }
        // De-dupe while preserving order so a repeated id can't double-seed rows.
        for (String audienceId : new LinkedHashSet<>(audienceIds)) {
            attachAudienceToPoolInternal(poolId, audienceId, addedByUserId);
        }
    }

    private void attachAudienceToPoolInternal(String poolId, String audienceId, String addedByUserId) {
        if (!attachAudienceInternal(poolId, audienceId)) {
            return;
        }

        // Seed member rows for the new audience using existing pool members.
        List<CounselorPoolMember> existingRows = poolMemberRepository.findByPoolId(poolId);
        boolean unifiedRotation = poolRepository.findById(poolId)
                .map(p -> Boolean.TRUE.equals(p.getUnifiedRotationOrder()))
                .orElse(false);
        if (unifiedRotation) {
            // Pool-wide rotation: the new list takes the pool's rotation order, so it matches the
            // others instead of whatever order the rows come back in.
            List<String> poolOrder = PoolRotationOrder.canonical(existingRows);
            for (int i = 0; i < poolOrder.size(); i++) {
                createMemberRow(poolId, audienceId, poolOrder.get(i), i + 1, addedByUserId);
            }
            return;
        }
        // Display order matches the member's position when listed by added_at.
        // Distinct counselors in this pool (order: first appearance in existing rows)
        LinkedHashMap<String, Integer> counselorToOrder = new LinkedHashMap<>();
        for (CounselorPoolMember row : existingRows) {
            counselorToOrder.putIfAbsent(row.getCounselorUserId(), counselorToOrder.size() + 1);
        }
        for (Map.Entry<String, Integer> entry : counselorToOrder.entrySet()) {
            createMemberRow(poolId, audienceId, entry.getKey(), entry.getValue(), addedByUserId);
        }
    }

    @Transactional
    public void removeAudienceFromPool(String poolId, String audienceId) {
        CounselorPoolAudience link = poolAudienceRepository.findByAudienceId(audienceId)
                .orElseThrow(() -> new VacademyException("Audience not linked to any pool"));
        if (!link.getPoolId().equals(poolId)) {
            throw new VacademyException("Audience does not belong to the specified pool");
        }
        // Delete member rows for this (pool, audience). No bulk method on repo — manual.
        List<CounselorPoolMember> rowsToDelete = poolMemberRepository
                .findByPoolIdAndAudienceIdOrderByDisplayOrderAsc(poolId, audienceId);
        poolMemberRepository.deleteAll(rowsToDelete);
        poolAudienceRepository.delete(link);
    }

    // ────────────────────────────────────────────────────────────────
    // Counselor membership
    // ────────────────────────────────────────────────────────────────

    /**
     * Add one or more counselors to the pool atomically. Each counselor is
     * appended to the bottom of the rotation for every audience. If any id
     * fails, the whole batch rolls back.
     */
    @Transactional
    public void addCounselorsToPool(String poolId, List<String> counselorUserIds, String addedByUserId) {
        ensurePoolExists(poolId);
        if (counselorUserIds == null || counselorUserIds.isEmpty()) {
            throw new VacademyException("counselor_user_ids must be a non-empty list");
        }

        List<CounselorPoolAudience> audiences = poolAudienceRepository.findByPoolId(poolId);
        if (audiences.isEmpty()) {
            // Pool has no audiences yet. Track an intent? For now, no-op with informational throw.
            throw new VacademyException("Add at least one audience to the pool before adding counselors.");
        }

        // De-dupe while preserving order so a repeated id can't shift ordering.
        for (String counselorUserId : new LinkedHashSet<>(counselorUserIds)) {
            addCounselorToAudiences(poolId, audiences, counselorUserId, addedByUserId);
        }
    }

    private void addCounselorToAudiences(String poolId, List<CounselorPoolAudience> audiences,
                                         String counselorUserId, String addedByUserId) {
        // For each audience, append this counselor at the bottom of the rotation.
        for (CounselorPoolAudience pa : audiences) {
            String audienceId = pa.getAudienceId();
            if (poolMemberRepository.existsByPoolIdAndAudienceIdAndCounselorUserId(poolId, audienceId, counselorUserId)) {
                continue; // Idempotent for this (audience, counselor)
            }
            int nextOrder = poolMemberRepository
                    .findByPoolIdAndAudienceIdOrderByDisplayOrderAsc(poolId, audienceId)
                    .stream()
                    .mapToInt(CounselorPoolMember::getDisplayOrder)
                    .max()
                    .orElse(0) + 1;
            createMemberRow(poolId, audienceId, counselorUserId, nextOrder, addedByUserId);
        }
    }

    @Transactional
    public void removeCounselorFromPool(String poolId, String counselorUserId) {
        List<CounselorPoolMember> rows = poolMemberRepository.findByPoolIdAndCounselorUserId(poolId, counselorUserId);
        if (rows.isEmpty()) {
            throw new VacademyException("Counselor not in pool");
        }
        poolMemberRepository.deleteAll(rows);
    }

    /**
     * Replace the display_order of counselors for a single (pool, audience) pair.
     * Accepts the desired counselor_user_ids in the order they should rotate.
     * Validates: every id must be an existing member of (pool, audience); the input
     * list must cover EVERY current member (no missing, no extras).
     */
    /**
     * Choose WHEN this list hands out a counsellor — at intake (default) or only on demand.
     * On-demand is the AI-first setting: the lead stays unowned so the CALL_AI node dials it,
     * and the pool assigns only when the outcome processor asks (qualified, or retries
     * exhausted). Nothing else about the pool changes; members and rotation are untouched.
     */
    @Transactional
    public void updateAudienceAssignOnIntake(String poolId, String audienceId, boolean assignOnIntake) {
        CounselorPoolAudience link = poolAudienceRepository.findByAudienceId(audienceId)
                .filter(a -> poolId.equals(a.getPoolId()))
                .orElseThrow(() -> new VacademyException("Audience is not attached to this pool"));
        link.setAssignOnIntake(assignOnIntake);
        poolAudienceRepository.save(link);
        log.info("Pool {} audience {}: assign_on_intake={}", poolId, audienceId, assignOnIntake);
    }

    @Transactional
    public void updateAudienceMemberOrder(String poolId, String audienceId,
                                          List<String> orderedCounselorUserIds) {
        if (orderedCounselorUserIds == null || orderedCounselorUserIds.isEmpty()) {
            throw new VacademyException("counselor_user_ids must be a non-empty ordered list");
        }
        List<CounselorPoolMember> existing = poolMemberRepository
                .findByPoolIdAndAudienceIdOrderByDisplayOrderAsc(poolId, audienceId);
        if (existing.isEmpty()) {
            throw new VacademyException("No members configured for this audience in the pool");
        }
        Set<String> existingIds = existing.stream()
                .map(CounselorPoolMember::getCounselorUserId)
                .collect(Collectors.toSet());
        Set<String> requestedIds = new HashSet<>(orderedCounselorUserIds);
        if (requestedIds.size() != orderedCounselorUserIds.size()) {
            throw new VacademyException("Ordered list contains duplicate counselors");
        }
        if (!existingIds.equals(requestedIds)) {
            throw new VacademyException("Ordered list must cover exactly the existing members of this audience");
        }
        Map<String, CounselorPoolMember> rowsByCounselor = existing.stream()
                .collect(Collectors.toMap(CounselorPoolMember::getCounselorUserId, m -> m));
        for (int i = 0; i < orderedCounselorUserIds.size(); i++) {
            CounselorPoolMember row = rowsByCounselor.get(orderedCounselorUserIds.get(i));
            row.setDisplayOrder(i + 1);
            poolMemberRepository.save(row);
        }
    }

    @Transactional
    public void updateMemberStatus(String poolId, String counselorUserId, UpdateMemberStatusRequest request,
                                   CustomUserDetails admin) {
        String status = request.getStatus();
        if (!PoolStatus.ACTIVE.name().equals(status) && !PoolStatus.INACTIVE.name().equals(status)) {
            throw new VacademyException("status must be ACTIVE or INACTIVE");
        }

        String backupId = request.getBackupCounselorUserId();
        boolean reassignExistingLeads = Boolean.TRUE.equals(request.getReassignExistingLeads());
        if (PoolStatus.INACTIVE.name().equals(status)) {
            requireNonBlank(backupId, "backup_counselor_user_id is required when marking INACTIVE");
            if (counselorUserId.equals(backupId)) {
                throw new VacademyException("Backup must be a different counselor");
            }
            // No pool-membership check on the backup. Backups can be any institute
            // counsellor — even one who isn't in this pool — so admin can temporarily
            // route leads to someone outside the team while the primary is paused.
            // The frontend dropdown already filters out inactive pool members; here
            // we trust the id and rely on app-layer rules upstream.
        } else {
            backupId = null; // clear backup when going back to ACTIVE
            reassignExistingLeads = false; // flag only meaningful on the INACTIVE path
        }

        int updated = poolMemberRepository.bulkUpdateStatusForCounselorInPool(poolId, counselorUserId, status, backupId);
        if (updated == 0) {
            throw new VacademyException("Counselor is not in this pool");
        }

        if (reassignExistingLeads) {
            CounselorPool pool = poolRepository.findById(poolId)
                    .orElseThrow(() -> new VacademyException("Pool not found: " + poolId));
            reassignOpenLeadsToBackup(pool, counselorUserId, backupId, admin);
        }
    }

    /**
     * Move every OPEN lead currently assigned to the inactivated counselor
     * (within this pool's audiences) to the backup. Each lead is routed
     * through {@link UserLeadProfileService#assignCounselor} so the workflow
     * trigger ({@code LEAD_ASSIGNED_TO_COUNSELOR}) fires per lead exactly
     * like the manual reassign endpoint does. A {@code COUNSELOR_ASSIGNED}
     * journey-timeline event is logged for each, with the acting admin as
     * the actor — that way Charlie picking up Bhavna's 12 leads shows up
     * on each of those leads' timelines, matching the audit trail produced
     * by clicking Reassign by hand. The backup also gets a single batched
     * bell notification ("N leads reassigned to you") — one alert for the
     * whole operation, not one per lead.
     */
    private void reassignOpenLeadsToBackup(CounselorPool pool, String fromCounselorUserId,
                                           String backupUserId, CustomUserDetails admin) {
        String instituteId = pool.getInstituteId();
        List<String> userIds = userLeadProfileRepository.findOpenLeadUserIdsForCounselorInPool(
                pool.getId(), fromCounselorUserId, instituteId);
        if (userIds.isEmpty()) {
            log.info("No open leads to reassign for counselor={} in pool={} (institute={})",
                    fromCounselorUserId, pool.getId(), instituteId);
            return;
        }
        String backupName = resolveCounselorDisplayName(backupUserId);

        String actorId = admin != null ? admin.getUserId() : null;
        String actorName = admin != null ? admin.getUsername() : null;

        for (String userId : userIds) {
            // Writes assigned_counselor_id + assigned_counselor_name and emits
            // LEAD_ASSIGNED_TO_COUNSELOR. Joins the outer @Transactional via
            // REQUIRED propagation, so a failure here rolls back the whole
            // mark-inactive operation (all-or-nothing).
            var updatedProfile = userLeadProfileService.assignCounselor(userId, instituteId, backupUserId, backupName);

            // Timeline event mirrors the manual reassign controller's payload so
            // the journey timeline reads identically regardless of how the
            // reassign happened. logJourneyEvent is REQUIRES_NEW — wrapped in
            // try/catch so logging failures don't roll back the reassignment.
            try {
                timelineEventService.logJourneyEvent(
                        "USER_LEAD_PROFILE", updatedProfile.getId(),
                        LeadJourneyActionType.COUNSELOR_ASSIGNED,
                        "ADMIN", actorId, actorName,
                        "Counselor reassigned",
                        "Reassigned to " + (backupName != null ? backupName : backupUserId)
                                + " (backup for inactivated counselor in pool \"" + pool.getName() + "\")",
                        Map.of(
                                "counselor_id", backupUserId,
                                "counselor_name", backupName != null ? backupName : "",
                                "reassigned_from", fromCounselorUserId,
                                "pool_id", pool.getId(),
                                "trigger", "POOL_MEMBER_INACTIVATED",
                                "assigned_by", actorName != null ? actorName : ""),
                        userId);
            } catch (Exception e) {
                log.warn("Failed to log COUNSELOR_ASSIGNED timeline event for user={} pool={}: {}",
                        userId, pool.getId(), e.getMessage());
            }
        }

        // ONE bell alert to the backup ("12 leads reassigned to you"), never
        // one per lead. Best-effort inside the notifier, so a notification
        // blip can't roll back the reassignment — same fire-inside-transaction
        // posture as the pool auto-assign alert in CounselorAssignmentService.
        leadAssignmentNotifier.notifyBatchAssigned(
                instituteId, backupUserId, userIds.size(),
                "backup for pool \"" + pool.getName() + "\"");

        log.info("Reassigned {} open leads from counselor={} to backup={} in pool={} (institute={})",
                userIds.size(), fromCounselorUserId, backupUserId, pool.getId(), instituteId);
    }

    /**
     * Set monthly_target per audience for one counsellor in one pool. Each
     * entry in the request is applied independently — null clears the target,
     * non-null sets it. The matrix structure (one row per (pool, audience,
     * counsellor)) means each entry maps to exactly one row update.
     *
     * Validation:
     *   - monthly_target must be null or >= 0 (negative values rejected)
     *
     * Intentionally NOT validated (UI guarantees, harmless when violated):
     *   - whether the counsellor has a row for the supplied audience_id
     *   - whether the audience_id belongs to this pool
     * In both cases an UPDATE affecting 0 rows is a silent no-op, which is
     * the intended behaviour for direct API hits with stale or invalid ids.
     */
    @Transactional
    public void updateMemberMonthlyTargets(String poolId, String counselorUserId,
                                           UpdateMemberMonthlyTargetsRequest request) {
        if (request == null || request.getTargets() == null || request.getTargets().isEmpty()) {
            return; // Nothing to do — same shape as a save-with-no-changes.
        }
        for (UpdateMemberMonthlyTargetsRequest.TargetEntry entry : request.getTargets()) {
            requireNonBlank(entry.getAudienceId(), "audience_id is required for each target entry");
            Integer target = entry.getMonthlyTarget();
            if (target != null && target < 0) {
                throw new VacademyException("monthly_target must be zero or positive");
            }
            poolMemberRepository.updateMonthlyTarget(
                    poolId, entry.getAudienceId(), counselorUserId, target);
        }
    }

    /**
     * List every pool (in the given institute) where this counselor currently
     * has at least one ACTIVE row. Pools where they're already INACTIVE are
     * excluded — the multi-pool "mark inactive" UI only lets admin act on
     * pools where the counselor is still operational.
     *
     * Pool-level status mirrors the UI's rollup: ACTIVE iff every member row
     * in that pool is ACTIVE.
     */
    @Transactional(readOnly = true)
    public List<CounselorPoolMembershipDTO> listActiveMembershipsForCounselor(String instituteId,
                                                                              String counselorUserId) {
        requireNonBlank(instituteId, "instituteId is required");
        requireNonBlank(counselorUserId, "counselorUserId is required");

        List<CounselorPoolMember> rows = poolMemberRepository
                .findByInstituteAndCounselor(instituteId, counselorUserId);
        if (rows.isEmpty()) {
            return List.of();
        }

        // Group by pool, roll up status
        Map<String, List<CounselorPoolMember>> rowsByPool = rows.stream()
                .collect(Collectors.groupingBy(CounselorPoolMember::getPoolId));

        List<String> activePoolIds = rowsByPool.entrySet().stream()
                .filter(e -> e.getValue().stream()
                        .allMatch(m -> PoolStatus.ACTIVE.name().equals(m.getStatus())))
                .map(Map.Entry::getKey)
                .toList();
        if (activePoolIds.isEmpty()) {
            return List.of();
        }

        Map<String, String> poolNameById = poolRepository.findAllById(activePoolIds).stream()
                .collect(Collectors.toMap(CounselorPool::getId, CounselorPool::getName));

        return activePoolIds.stream()
                .map(poolId -> CounselorPoolMembershipDTO.builder()
                        .poolId(poolId)
                        .poolName(poolNameById.getOrDefault(poolId, poolId))
                        .status(PoolStatus.ACTIVE.name())
                        .build())
                .toList();
    }

    /**
     * Flip the counselor's status across several pools in one transactional
     * call. Per pool, the same per-pool logic runs (validate, write member
     * rows, optionally reassign open leads). If any pool fails, the whole
     * transaction rolls back — admin sees one error and nothing changed.
     *
     * Backup is one id for all pools — a backup is just any institute
     * counsellor and not pool-membership-bound.
     */
    @Transactional
    public void bulkUpdateMemberStatusAcrossPools(String counselorUserId, BulkUpdateMemberStatusRequest request,
                                                  CustomUserDetails admin) {
        requireNonBlank(counselorUserId, "counselorUserId is required");
        if (request == null || request.getPoolIds() == null || request.getPoolIds().isEmpty()) {
            throw new VacademyException("pool_ids must contain at least one pool");
        }
        // De-dup but preserve insertion order so log lines are deterministic.
        List<String> poolIds = request.getPoolIds().stream()
                .filter(Objects::nonNull)
                .filter(s -> !s.isBlank())
                .distinct()
                .toList();
        if (poolIds.isEmpty()) {
            throw new VacademyException("pool_ids must contain at least one pool");
        }

        UpdateMemberStatusRequest perPool = UpdateMemberStatusRequest.builder()
                .status(request.getStatus())
                .backupCounselorUserId(request.getBackupCounselorUserId())
                .reassignExistingLeads(request.getReassignExistingLeads())
                .build();
        for (String poolId : poolIds) {
            // Each iteration is part of the outer @Transactional — any throw
            // from updateMemberStatus rolls back the work done for earlier pools.
            updateMemberStatus(poolId, counselorUserId, perPool, admin);
        }
    }

    /**
     * Best-effort display-name lookup via auth-service. Name is a denormalized
     * cache on user_lead_profile; failure to resolve is non-fatal — the leads
     * still get repointed, the cached name just becomes null and the UI falls
     * back to "Unassigned"-style rendering until the next assignment refreshes it.
     */
    private String resolveCounselorDisplayName(String counselorUserId) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(counselorUserId));
            if (!users.isEmpty() && users.get(0) != null) {
                return users.get(0).getFullName();
            }
        } catch (Exception e) {
            log.warn("Failed to resolve display name for counselor={}: {}", counselorUserId, e.getMessage());
        }
        return null;
    }

    // ────────────────────────────────────────────────────────────────
    // Internal helpers
    // ────────────────────────────────────────────────────────────────

    /**
     * Links the audience to the pool. Returns false when it was already linked to
     * this same pool (nothing to do). A link left pointing at a pool that no longer
     * exists has no owner to protect (pool_id has no FK), so it is dropped instead
     * of blocking the attach.
     */
    private boolean attachAudienceInternal(String poolId, String audienceId) {
        requireNonBlank(audienceId, "audience_id is required");
        Optional<CounselorPoolAudience> existing = poolAudienceRepository.findByAudienceId(audienceId);
        if (existing.isPresent()) {
            String ownerPoolId = existing.get().getPoolId();
            if (poolId.equals(ownerPoolId)) {
                return false;
            }
            if (poolRepository.existsById(ownerPoolId)) {
                throw new VacademyException("Audience is already linked to a pool. Remove it from the existing pool first.");
            }
            log.warn("Dropping stale pool link {} — audience={} pointed at missing pool={}",
                    existing.get().getId(), audienceId, ownerPoolId);
            poolAudienceRepository.delete(existing.get());
            // audience_id is UNIQUE and Hibernate flushes inserts before deletes.
            poolAudienceRepository.flush();
        }
        poolAudienceRepository.save(CounselorPoolAudience.builder()
                .poolId(poolId)
                .audienceId(audienceId)
                .build());
        return true;
    }

    private void createMemberRow(String poolId, String audienceId, String counselorUserId,
                                 int displayOrder, String addedByUserId) {
        if (poolMemberRepository.existsByPoolIdAndAudienceIdAndCounselorUserId(poolId, audienceId, counselorUserId)) {
            return;
        }
        poolMemberRepository.save(CounselorPoolMember.builder()
                .poolId(poolId)
                .audienceId(audienceId)
                .counselorUserId(counselorUserId)
                .displayOrder(displayOrder)
                .status(PoolStatus.ACTIVE.name())
                .addedBy(addedByUserId)
                .build());
    }

    private void ensurePoolExists(String poolId) {
        if (!poolRepository.existsById(poolId)) {
            throw new VacademyException("Pool not found: " + poolId);
        }
    }

    private static void validateAssignmentMode(String mode) {
        try {
            AssignmentMode.valueOf(mode);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new VacademyException("assignment_mode must be one of MANUAL, ROUND_ROBIN, TIME_BASED");
        }
    }

    /**
     * Validates the schedule_pattern string. Returns null when input is null
     * or blank — the column is nullable so the UI can distinguish "not picked
     * yet" (NULL) from "explicitly picked X".
     */
    private static String resolveSchedulePattern(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return SchedulePattern.valueOf(raw).name();
        } catch (IllegalArgumentException e) {
            throw new VacademyException("schedule_pattern must be one of PER_DAY, SAME_HOURS_ALL_DAYS");
        }
    }

    private static void requireNonBlank(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new VacademyException(message);
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Entity → DTO mappers
    // ────────────────────────────────────────────────────────────────

    private static CounselorPoolDTO toPoolDTO(CounselorPool p,
                                              List<PoolAudienceDTO> audiences,
                                              List<PoolMemberDTO> members,
                                              List<PoolShiftDTO> shifts) {
        return CounselorPoolDTO.builder()
                .id(p.getId())
                .instituteId(p.getInstituteId())
                .name(p.getName())
                .description(p.getDescription())
                .assignmentMode(p.getAssignmentMode())
                .schedulePattern(p.getSchedulePattern())
                .shiftAware(p.getShiftAware())
                .unifiedRotationOrder(p.getUnifiedRotationOrder())
                .createdBy(p.getCreatedBy())
                .createdAt(p.getCreatedAt())
                .updatedAt(p.getUpdatedAt())
                .audiences(audiences)
                .members(members)
                .shifts(shifts)
                .build();
    }

    private static PoolAudienceDTO toAudienceDTO(CounselorPoolAudience a) {
        return PoolAudienceDTO.builder()
                .id(a.getId())
                .poolId(a.getPoolId())
                .audienceId(a.getAudienceId())
                .lastAssignedCounselorId(a.getLastAssignedCounselorId())
                .lastAssignedAt(a.getLastAssignedAt())
                .addedAt(a.getAddedAt())
                .assignOnIntake(a.getAssignOnIntake() == null || a.getAssignOnIntake())
                .build();
    }

    private static PoolMemberDTO toMemberDTO(CounselorPoolMember m) {
        return PoolMemberDTO.builder()
                .id(m.getId())
                .poolId(m.getPoolId())
                .audienceId(m.getAudienceId())
                .counselorUserId(m.getCounselorUserId())
                .displayOrder(m.getDisplayOrder())
                .monthlyTarget(m.getMonthlyTarget())
                .status(m.getStatus())
                .backupCounselorUserId(m.getBackupCounselorUserId())
                .addedBy(m.getAddedBy())
                .addedAt(m.getAddedAt())
                .updatedAt(m.getUpdatedAt())
                .build();
    }

    static PoolShiftDTO toShiftDTO(CounselorPoolShift s) {
        return PoolShiftDTO.builder()
                .id(s.getId())
                .poolId(s.getPoolId())
                .dayOfWeek(s.getDayOfWeek())
                .startTime(s.getStartTime())
                .endTime(s.getEndTime())
                .label(s.getLabel())
                .status(s.getStatus())
                .createdAt(s.getCreatedAt())
                .updatedAt(s.getUpdatedAt())
                .build();
    }

    static PoolShiftMemberDTO toShiftMemberDTO(CounselorPoolShiftMember m) {
        return PoolShiftMemberDTO.builder()
                .id(m.getId())
                .shiftId(m.getShiftId())
                .counselorUserId(m.getCounselorUserId())
                .status(m.getStatus())
                .addedAt(m.getAddedAt())
                .build();
    }
}
