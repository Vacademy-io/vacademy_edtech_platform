package vacademy.io.admin_core_service.features.counselor_pool.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadAssignmentNotifier;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPool;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolAudience;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolMember;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolShift;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolShiftMember;
import vacademy.io.admin_core_service.features.counselor_pool.enums.AssignmentMode;
import vacademy.io.admin_core_service.features.counselor_pool.enums.PoolStatus;
import vacademy.io.admin_core_service.features.counselor_pool.enums.ShiftDayOfWeek;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolAudienceRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolMemberRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolShiftMemberRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolShiftRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;

import java.sql.Time;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;

/**
 * The routing engine. Given an audience that just received a lead, decide
 * which counselor (if any) gets it. Runs synchronously in the caller's
 * request thread so the assigned counselor is visible immediately when the
 * lead-submit response returns.
 *
 *   1. Resolve pool from audience
 *   2. Switch on mode (MANUAL leaves it unassigned)
 *   3. Build the eligible candidate set — ACTIVE pool members only
 *      (TIME_BASED / shift_aware ROUND_ROBIN additionally requires being on
 *      shift right now)
 *   4. Acquire pessimistic locks on counselor_pool, then counselor_pool_audience
 *   5. Pick next via the POOL-WIDE last-assigned counselor (latest
 *      last_assigned_at across the pool's lists) + display_order, resuming
 *      from the last-assigned member's true order even if they've since gone
 *      INACTIVE or off-shift, so a status flip never re-biases the rotation.
 *      With unified_rotation_order on, "next" comes from the pool's single
 *      order (PoolRotationOrder) instead of this list's display_order.
 *   6. Persist pointer update
 *
 * New leads always go to a currently-ACTIVE member chosen by fair rotation —
 * there is no "redirect an inactive member's new leads to their backup" step
 * here (an earlier version had one; it let a single backup silently absorb
 * several inactive counsellors' shares, defeating equal distribution). The
 * backup field is still used elsewhere, for one-time bulk reassignment of a
 * counsellor's EXISTING open leads at the moment they're marked inactive
 * (see {@code CounselorPoolService.reassignOpenLeadsToBackup}).
 *
 * The resolved counselor user_id is returned to the caller, who is
 * responsible for writing it onto user_lead_profile.assigned_counselor_id.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CounselorAssignmentService {

    /** v1: institute timezone is hardcoded. Move to institutes.timezone when multi-region support is added. */
    private static final ZoneId INSTITUTE_TIMEZONE = ZoneId.of("Asia/Kolkata");

    private final CounselorPoolRepository poolRepository;
    private final CounselorPoolAudienceRepository poolAudienceRepository;
    private final CounselorPoolMemberRepository poolMemberRepository;
    private final CounselorPoolShiftRepository shiftRepository;
    private final CounselorPoolShiftMemberRepository shiftMemberRepository;
    private final AudienceRepository audienceRepository;        // for resolving campaign name in alert text
    private final NotificationService notificationService;      // existing helper that wraps notification_service HTTP call
    private final LeadAssignmentNotifier leadAssignmentNotifier; // shared bell-alert sender for ALL assignment paths

    /**
     * Pick a counselor for a lead that just arrived on the given audience.
     *
     * @return the resolved counselor user_id, or Optional.empty() if the
     *         audience has no pool, the pool is MANUAL, no eligible
     *         (ACTIVE, on-shift-if-applicable) counselor was found, or any
     *         other reason routing should be skipped.
     */
    @Transactional
    public Optional<String> assignCounselorForLead(String audienceId) {
        return assignCounselorForLead(audienceId, false);
    }

    /**
     * Intake variant: the same rotation, but honours the list's {@code assign_on_intake}
     * choice. A list set to on-demand (AI-first) returns empty here so the lead arrives
     * unowned and the CALL_AI node is free to dial it; the plain
     * {@link #assignCounselorForLead(String)} — what the AI-call outcome processor and the
     * exhausted-retries hand-off call — still assigns for that list.
     */
    @Transactional
    public Optional<String> assignCounselorOnIntake(String audienceId) {
        return assignCounselorForLead(audienceId, true);
    }

    private Optional<String> assignCounselorForLead(String audienceId, boolean intake) {
        // Step 1: resolve the pool
        Optional<CounselorPoolAudience> poolAudienceOpt = poolAudienceRepository.findByAudienceId(audienceId);
        if (poolAudienceOpt.isEmpty()) {
            return Optional.empty(); // Audience isn't in any pool — nothing to do.
        }
        if (intake && Boolean.FALSE.equals(poolAudienceOpt.get().getAssignOnIntake())) {
            log.info("Audience {} is on-demand (assign_on_intake=false) — leaving the new lead unassigned", audienceId);
            return Optional.empty();
        }
        String poolId = poolAudienceOpt.get().getPoolId();

        CounselorPool pool = poolRepository.findById(poolId).orElse(null);
        if (pool == null) {
            log.warn("Pool referenced by counselor_pool_audience does not exist: poolId={}", poolId);
            return Optional.empty();
        }

        // Step 2: check the pool's mode
        AssignmentMode mode;
        try {
            mode = AssignmentMode.valueOf(pool.getAssignmentMode());
        } catch (IllegalArgumentException e) {
            log.warn("Unknown assignment_mode '{}' on pool {}", pool.getAssignmentMode(), poolId);
            return Optional.empty();
        }
        if (mode == AssignmentMode.MANUAL) {
            return Optional.empty();
        }

        // Step 3: fetch every member row (all statuses) — needed so the rotation pointer can
        // still be resolved to its true display_order even after that member goes INACTIVE or
        // off-shift, then narrow to who's actually eligible to receive a NEW lead right now.
        List<CounselorPoolMember> allMembers = poolMemberRepository
                .findByPoolIdAndAudienceIdOrderByDisplayOrderAsc(pool.getId(), audienceId);
        if (allMembers.isEmpty()) {
            log.info("Pool {} has no members configured for audience={}", poolId, audienceId);
            sendUnassignedAlertToPoolAdmin(pool, audienceId);
            return Optional.empty();
        }
        List<CounselorPoolMember> candidates = filterEligibleCandidates(pool, allMembers, mode);
        if (candidates.isEmpty()) {
            log.info("No ACTIVE (eligible) counselors for audience={} in pool={}", audienceId, poolId);
            sendUnassignedAlertToPoolAdmin(pool, audienceId);
            return Optional.empty();
        }

        // Step 4: pessimistic locks — pool row first (serializes assignments across every list of
        // the pool, so the pool-wide pointer below can't be read by two leads at once), then the
        // audience row. Always pool → audience, so concurrent assignments can't deadlock.
        if (poolRepository.findByIdForUpdate(poolId).isEmpty()) {
            return Optional.empty(); // Race: pool deleted after resolution. Transient — no alert.
        }
        CounselorPoolAudience locked = poolAudienceRepository.findByAudienceIdForUpdate(audienceId)
                .orElse(null);
        if (locked == null) {
            // Race: audience was removed between resolution and lock. Bail (transient — no alert).
            return Optional.empty();
        }

        // Step 5: pick the next ACTIVE member by rotation. picked is always eligible — no backup
        // redirection needed for routing a new lead.
        Optional<CounselorPoolMember> inPoolOrder = Boolean.TRUE.equals(pool.getUnifiedRotationOrder())
                ? pickNextInPoolOrder(poolId, candidates)
                : Optional.empty();
        CounselorPoolMember picked = inPoolOrder.orElseGet(() -> pickNext(candidates, allMembers,
                resolveRotationPointer(poolId, allMembers, locked.getLastAssignedCounselorId())));

        // Step 6: persist pointer as the actual recipient.
        poolAudienceRepository.updateLastAssigned(
                locked.getId(),
                picked.getCounselorUserId(),
                new Timestamp(System.currentTimeMillis()));

        // Step 7: bell-icon notification to the assigned counselor.
        sendNewLeadNotificationToCounsellor(pool, audienceId, picked.getCounselorUserId());

        return Optional.of(picked.getCounselorUserId());
    }

    // ────────────────────────────────────────────────────────────────
    // System alert dispatch (best-effort; failures don't break assignment)
    // ────────────────────────────────────────────────────────────────

    /**
     * Bell-icon notification for a counselor who just got a new lead.
     * Delegates to {@link LeadAssignmentNotifier} — the shared sender used by
     * every assignment path (manual, bulk import, reassign, backup) — with
     * the exact text/settings this method historically produced.
     */
    private void sendNewLeadNotificationToCounsellor(CounselorPool pool, String audienceId, String counselorUserId) {
        if (counselorUserId == null || counselorUserId.isBlank()) {
            return;
        }
        leadAssignmentNotifier.notifyAssigned(
                pool.getInstituteId(), counselorUserId, null, resolveCampaignName(audienceId));
    }

    /**
     * Alert the pool's creator that a lead which SHOULD have been auto-assigned
     * (mode != MANUAL) could not be routed. Lead is unassigned; admin needs to
     * either fix counselor configuration or assign manually.
     */
    private void sendUnassignedAlertToPoolAdmin(CounselorPool pool, String audienceId) {
        String adminUserId = pool.getCreatedBy();
        if (adminUserId == null || adminUserId.isBlank()) {
            log.warn("Pool {} has no created_by; cannot route unassigned-lead alert", pool.getId());
            return;
        }
        String campaignName = resolveCampaignName(audienceId);
        try {
            notificationService.createSystemAlertAnnouncement(
                    pool.getInstituteId(),
                    List.of(adminUserId),
                    "Lead could not be auto-assigned",
                    "A lead in pool \"" + pool.getName() + "\" (campaign: " + campaignName + ") could not be auto-assigned. "
                            + "Either all counselors are inactive, or the audience has no members. Please assign manually.",
                    "system",
                    "System",
                    "ADMIN",
                    Map.of(
                            "priority", 3,
                            "isDismissible", true,
                            "showBadge", true,
                            "isActive", true
                    )
            );
        } catch (Exception e) {
            log.warn("Failed to send unassigned-lead alert to admin={} for pool={}: {}",
                    adminUserId, pool.getId(), e.getMessage());
        }
    }

    private String resolveCampaignName(String audienceId) {
        return audienceRepository.findById(audienceId)
                .map(Audience::getCampaignName)
                .filter(name -> name != null && !name.isBlank())
                .orElse("Untitled campaign");
    }

    // ────────────────────────────────────────────────────────────────
    // Candidate set construction
    // ────────────────────────────────────────────────────────────────

    /**
     * Narrow {@code allMembers} down to who can actually receive a NEW lead right now:
     * always ACTIVE, and — for TIME_BASED or a shift_aware ROUND_ROBIN pool — also on
     * shift at this moment. Order is preserved (still ascending by display_order).
     */
    private List<CounselorPoolMember> filterEligibleCandidates(CounselorPool pool,
                                                                List<CounselorPoolMember> allMembers,
                                                                AssignmentMode mode) {
        List<CounselorPoolMember> activeMembers = allMembers.stream()
                .filter(m -> PoolStatus.ACTIVE.name().equals(m.getStatus()))
                .toList();

        // Shift-gating applies to TIME_BASED always, and to ROUND_ROBIN only when
        // the pool opted in via shift_aware. A plain ROUND_ROBIN pool
        // (shift_aware = false) treats every ACTIVE member as a candidate.
        boolean shiftGated = mode == AssignmentMode.TIME_BASED
                || (mode == AssignmentMode.ROUND_ROBIN && Boolean.TRUE.equals(pool.getShiftAware()));
        if (!shiftGated) {
            return activeMembers;
        }

        // Filter to counselors currently on shift. When nobody is on shift the
        // candidate set is empty, so the caller leaves the lead unassigned and
        // alerts the pool admin — same behaviour as TIME_BASED.
        LocalDateTime nowInInstituteTz = LocalDateTime.now(INSTITUTE_TIMEZONE);
        String todayDayOfWeek = ShiftDayOfWeek.fromJavaDay(nowInInstituteTz.getDayOfWeek()).name();
        Time nowTime = Time.valueOf(nowInInstituteTz.toLocalTime().withNano(0));

        List<CounselorPoolShift> activeShifts = shiftRepository.findActiveShiftsForPoolAtTime(
                pool.getId(), todayDayOfWeek, nowTime);
        if (activeShifts.isEmpty()) {
            return List.of();
        }

        List<String> shiftIds = activeShifts.stream().map(CounselorPoolShift::getId).toList();
        Set<String> onShiftUserIds = shiftMemberRepository.findActiveMembersInShifts(shiftIds).stream()
                .map(CounselorPoolShiftMember::getCounselorUserId)
                .collect(Collectors.toSet());

        return activeMembers.stream()
                .filter(m -> onShiftUserIds.contains(m.getCounselorUserId()))
                .toList();
    }

    // ────────────────────────────────────────────────────────────────
    // Pointer-based rotation
    // ────────────────────────────────────────────────────────────────

    /**
     * Pools with {@code unified_rotation_order} on: the first candidate after the pool's
     * last-assigned counselor in the pool's single rotation order ({@link PoolRotationOrder}),
     * wrapping around. A list's own {@code display_order} can drift from the others, and reading
     * "next" from it skipped some counselors indefinitely. INACTIVE / off-shift rows still hold
     * their place in the order, so a status flip never re-biases the rotation. Empty when the
     * pool has no assignment yet or the last-assigned counselor has left the pool; the caller
     * then falls back to the per-list rotation.
     */
    private Optional<CounselorPoolMember> pickNextInPoolOrder(String poolId,
                                                              List<CounselorPoolMember> candidates) {
        String poolPointer = poolAudienceRepository
                .findFirstByPoolIdAndLastAssignedAtIsNotNullOrderByLastAssignedAtDesc(poolId)
                .map(CounselorPoolAudience::getLastAssignedCounselorId)
                .orElse(null);
        if (poolPointer == null) {
            return Optional.empty();
        }
        List<String> order = PoolRotationOrder.canonical(poolMemberRepository.findByPoolId(poolId));
        int pointerIndex = order.indexOf(poolPointer);
        if (pointerIndex < 0) {
            return Optional.empty();
        }
        Map<String, CounselorPoolMember> candidateById = candidates.stream()
                .collect(Collectors.toMap(CounselorPoolMember::getCounselorUserId, m -> m, (a, b) -> a));
        for (int step = 1; step <= order.size(); step++) {
            CounselorPoolMember next = candidateById.get(order.get((pointerIndex + step) % order.size()));
            if (next != null) {
                return Optional.of(next);
            }
        }
        return Optional.empty();
    }

    /**
     * Whose turn it was last. The rotation is pool-wide: the counselor who got the pool's most
     * recent lead on ANY list, as long as they're also a member of this list. A per-list pointer
     * alone never advances on a pool of many low-volume lists — each list's first lead goes to the
     * top of the order, so one counselor gets every lead. Falls back to this list's own pointer
     * when the pool-wide one isn't on this list (lists with different member sets).
     */
    private String resolveRotationPointer(String poolId,
                                          List<CounselorPoolMember> allMembers,
                                          String listPointer) {
        String poolPointer = poolAudienceRepository
                .findFirstByPoolIdAndLastAssignedAtIsNotNullOrderByLastAssignedAtDesc(poolId)
                .map(CounselorPoolAudience::getLastAssignedCounselorId)
                .orElse(null);
        boolean onThisList = poolPointer != null && allMembers.stream()
                .anyMatch(m -> poolPointer.equals(m.getCounselorUserId()));
        return onThisList ? poolPointer : listPointer;
    }

    /**
     * Pick the next counselor based on display_order and the last-assigned pointer.
     * Returns the first {@code candidates} member whose display_order is strictly
     * greater than the last-assigned member's order, wrapping to the first
     * candidate if none is found (or if there's no pointer yet).
     *
     * The last-assigned member's order is looked up in {@code allMembers} (every
     * status), not {@code candidates} — so if they've since gone INACTIVE or
     * dropped off shift, the rotation still resumes exactly where it left off
     * instead of restarting at the front of the list every time someone's status
     * changes. Only a truly-removed member (row deleted, order gone for good)
     * falls back to wrapping.
     */
    private CounselorPoolMember pickNext(List<CounselorPoolMember> candidates,
                                         List<CounselorPoolMember> allMembers,
                                         String lastAssignedUserId) {
        if (lastAssignedUserId == null) {
            return candidates.get(0);
        }
        Integer lastOrder = allMembers.stream()
                .filter(m -> lastAssignedUserId.equals(m.getCounselorUserId()))
                .map(CounselorPoolMember::getDisplayOrder)
                .findFirst()
                .orElse(null);
        if (lastOrder == null) {
            // Truly removed from the pool — no fair resume point exists. Restart.
            return candidates.get(0);
        }
        for (CounselorPoolMember m : candidates) {
            if (m.getDisplayOrder() > lastOrder) {
                return m;
            }
        }
        return candidates.get(0); // wrap
    }
}
