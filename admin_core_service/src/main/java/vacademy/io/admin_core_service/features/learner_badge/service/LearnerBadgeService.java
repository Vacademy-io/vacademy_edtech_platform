package vacademy.io.admin_core_service.features.learner_badge.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_badge.dto.AwardBadgeRequest;
import vacademy.io.admin_core_service.features.learner_badge.dto.AwardBadgeResponse;
import vacademy.io.admin_core_service.features.learner_badge.dto.AwardOutcome;
import vacademy.io.admin_core_service.features.learner_badge.dto.BadgeDefinition;
import vacademy.io.admin_core_service.features.learner_badge.dto.LearnerBadgeDTO;
import vacademy.io.admin_core_service.features.learner_badge.dto.SyncUnlocksRequest;
import vacademy.io.admin_core_service.features.learner_badge.entity.LearnerBadge;
import vacademy.io.admin_core_service.features.learner_badge.entity.LearnerBadgeStatus;
import vacademy.io.admin_core_service.features.learner_badge.repository.LearnerBadgeRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.exceptions.ForbiddenException;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class LearnerBadgeService {

    public static final String SOURCE_MANUAL = "MANUAL";
    public static final String SOURCE_AUTO = "AUTO";

    /** learner_badge.badge_name / badge_icon are varchar(255). */
    private static final int MAX_SNAPSHOT_LENGTH = 255;

    private final LearnerBadgeRepository learnerBadgeRepository;
    private final NotificationService notificationService;
    private final BadgeCatalogueService badgeCatalogueService;
    private final StudentSessionInstituteGroupMappingRepository ssigmRepository;

    /**
     * Award a configured badge to one or more learners, in ONE transaction. Per learner:
     * <ul>
     *   <li>no active row → insert a MANUAL row ({@code NEW});</li>
     *   <li>active MANUAL row → untouched ({@code ALREADY_ACTIVE});</li>
     *   <li>active AUTO row (synced from the learner app) → upgraded in place to MANUAL —
     *       reason and awarded-by set, awarded-at re-stamped — so the staff recognition is
     *       recorded without tripping the one-active-row-per-badge index
     *       ({@code UPGRADED_FROM_AUTO}).</li>
     * </ul>
     * Newly-awarded and upgraded learners get ONE batched notification (one announcement +
     * one push for the whole list), sent after the transaction commits so a rollback never
     * leaves a learner with a "you earned a badge" alert for a badge they do not hold. The
     * notification is skipped entirely while the institute's badges master toggle is off
     * (learners cannot see badges then) — the response's {@code notified} says which.
     *
     * <p>Ids with no mapping row in the institute (not enrolled, not a contact, or a
     * different tenant's user) are reported as {@code NOT_ENROLLED} and never written or
     * notified — the staff caller's own membership is checked by the controller, this keeps
     * the TARGETS inside the tenant too.
     *
     * <p>{@code REQUIRES_NEW} so the awards commit in their own transaction rather than joining
     * the audit aspect's: a same-second race with a learner's sync-unlocks insert on the same
     * (user, badge) trips the partial unique index at THIS commit, where the controller can
     * catch the {@link DataIntegrityViolationException} and re-run once (the second pass then
     * finds the racing row and takes the upgrade / already-active branch).
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public AwardBadgeResponse award(AwardBadgeRequest request, String instituteId,
                                    String awardedByUserId, String awardedByName) {
        List<AwardOutcome> results = new ArrayList<>();
        List<String> toNotify = new ArrayList<>();
        int awarded = 0, alreadyHad = 0, upgraded = 0, notEnrolled = 0;

        Set<String> userIds = new LinkedHashSet<>();
        if (request.getUserIds() != null) {
            for (String id : request.getUserIds()) {
                if (id != null && !id.isBlank()) userIds.add(id.trim());
            }
        }
        Set<String> members = userIds.isEmpty() ? Set.of()
                : new HashSet<>(ssigmRepository.findUserIdsInInstitute(instituteId, userIds));
        Timestamp now = new Timestamp(System.currentTimeMillis());

        for (String userId : userIds) {
            if (!members.contains(userId)) {
                results.add(new AwardOutcome(userId, AwardOutcome.NOT_ENROLLED, null));
                notEnrolled++;
                continue;
            }
            Optional<LearnerBadge> existing =
                    learnerBadgeRepository.findActiveAward(userId, request.getBadgeId(), instituteId);

            if (existing.isPresent()) {
                LearnerBadge row = existing.get();
                if (SOURCE_AUTO.equals(row.getSource())) {
                    row.setSource(SOURCE_MANUAL);
                    row.setReason(request.getReason());
                    row.setAwardedByUserId(awardedByUserId);
                    row.setAwardedAt(now);
                    LearnerBadge saved = learnerBadgeRepository.save(row);
                    results.add(new AwardOutcome(userId, AwardOutcome.UPGRADED_FROM_AUTO,
                            LearnerBadgeDTO.fromEntity(saved)));
                    toNotify.add(userId);
                    upgraded++;
                } else {
                    // Already holds a staff award for this badge — keep it idempotent.
                    results.add(new AwardOutcome(userId, AwardOutcome.ALREADY_ACTIVE,
                            LearnerBadgeDTO.fromEntity(row)));
                    alreadyHad++;
                }
                continue;
            }

            LearnerBadge badge = new LearnerBadge();
            badge.setUserId(userId);
            badge.setInstituteId(instituteId);
            badge.setBadgeId(request.getBadgeId());
            badge.setBadgeName(truncate(request.getBadgeName()));
            badge.setBadgeIcon(truncate(request.getBadgeIcon()));
            badge.setBadgeDescription(request.getBadgeDescription());
            badge.setReason(request.getReason());
            badge.setSource(SOURCE_MANUAL);
            badge.setStatus(LearnerBadgeStatus.ACTIVE);
            badge.setAwardedByUserId(awardedByUserId);
            badge.setAwardedAt(now);

            LearnerBadge saved = learnerBadgeRepository.save(badge);
            results.add(new AwardOutcome(userId, AwardOutcome.NEW, LearnerBadgeDTO.fromEntity(saved)));
            toNotify.add(userId);
            awarded++;
        }

        boolean notified = false;
        if (!toNotify.isEmpty()) {
            if (badgeCatalogueService.isEnabled(instituteId)) {
                String badgeName = request.getBadgeName() != null && !request.getBadgeName().isBlank()
                        ? request.getBadgeName() : "a badge";
                scheduleAfterCommit(() -> notifyAwarded(instituteId, List.copyOf(toNotify),
                        request.getBadgeId(), badgeName, request.getReason(),
                        awardedByUserId, awardedByName));
                notified = true;
            } else {
                log.info("Badge award: badges are disabled for institute {}; {} learner(s) not notified",
                        instituteId, toNotify.size());
            }
        }

        return new AwardBadgeResponse(results, awarded, alreadyHad, upgraded, notEnrolled, notified);
    }

    /**
     * Persist a learner's client-computed auto-unlock badges (source = AUTO) so they show
     * on the in-app and public leaderboards, which read {@code learner_badge}. The learner
     * is taken from the JWT by the caller — never from the request body.
     *
     * <p>The client is NOT trusted beyond the badge id: the learner must be enrolled in the
     * institute (any status), the id must be a catalogue badge that is enabled and not
     * {@code manual} (or one of the six defaults when the institute has no stored list),
     * and the stored name/icon/description are taken from the catalogue entry, never from
     * the request. Anything else is skipped, so a forged sync cannot mint a staff-only badge
     * or rename a real one.
     *
     * <p>Idempotent and non-destructive: a badge is inserted only when NO row exists for that
     * (user, badge, institute). That skips badges already synced, admin-awarded (MANUAL),
     * or explicitly revoked by an admin — so sync never resurrects a revoked badge, never
     * duplicates, and never overwrites a manual award. Auto badges are not revoked here
     * (a badge, once earned, stays earned even if the trigger later lapses). No
     * notification is sent — the learner already saw the unlock in their own app.
     *
     * <p>Deliberately NOT {@code @Transactional}: each badge insert must commit independently
     * so that a rare concurrent same-user race (two dashboard loads inserting the same
     * badge) surfaces the unique-index violation synchronously per {@code save()} — where
     * the catch below can absorb it — instead of poisoning one shared transaction and
     * rolling back the whole batch at commit. The inserts are independent, so no atomicity
     * is lost.
     *
     * @return the number of newly-persisted badges.
     * @throws ForbiddenException when the learner has no enrollment in the institute.
     */
    public int syncAutoUnlocks(String userId, String instituteId,
                               List<SyncUnlocksRequest.UnlockedBadge> badges) {
        if (userId == null || userId.isBlank() || instituteId == null || instituteId.isBlank()) return 0;

        if (ssigmRepository.findLatestPackageSessionIdByUserIdAndInstituteId(userId, instituteId).isEmpty()) {
            throw new ForbiddenException("Access denied: learner is not enrolled in institute " + instituteId);
        }
        if (badges == null || badges.isEmpty()) return 0;

        Map<String, BadgeDefinition> allowed = badgeCatalogueService.syncableBadges(instituteId);

        int inserted = 0;
        for (SyncUnlocksRequest.UnlockedBadge b : badges) {
            if (b == null || b.getBadgeId() == null || b.getBadgeId().isBlank()) continue;
            BadgeDefinition def = allowed.get(b.getBadgeId());
            if (def == null) {
                log.debug("Auto-unlock sync: badge {} is not auto-unlockable in institute {}; skipped",
                        b.getBadgeId(), instituteId);
                continue;
            }
            if (learnerBadgeRepository.existsByUserIdAndBadgeIdAndInstituteId(
                    userId, b.getBadgeId(), instituteId)) {
                continue;
            }

            LearnerBadge badge = new LearnerBadge();
            badge.setUserId(userId);
            badge.setInstituteId(instituteId);
            badge.setBadgeId(def.getId());
            badge.setBadgeName(truncate(def.getName()));
            badge.setBadgeIcon(iconOrNull(def.getIcon()));
            badge.setBadgeDescription(def.getDescription());
            badge.setSource(SOURCE_AUTO);
            badge.setStatus(LearnerBadgeStatus.ACTIVE);
            badge.setAwardedAt(new Timestamp(System.currentTimeMillis()));

            try {
                learnerBadgeRepository.save(badge);
                inserted++;
            } catch (DataIntegrityViolationException e) {
                // A concurrent sync/award inserted the same badge first — the partial
                // unique index rejected the duplicate. Safe to ignore (idempotent).
                log.warn("Auto-unlock sync: duplicate insert for user {} badge {} in institute {} ignored ({})",
                        userId, def.getId(), instituteId, e.getMostSpecificCause().getMessage());
            }
        }
        return inserted;
    }

    /**
     * Revoke a learner's active award for a badge (keeps the row, flips status to REVOKED).
     * Works for BOTH sources — revoking an AUTO row is the admin's only defence against a
     * forged sync claim.
     */
    @Transactional
    public boolean revoke(String userId, String badgeId, String instituteId, String revokedByUserId) {
        Optional<LearnerBadge> existing =
                learnerBadgeRepository.findActiveAward(userId, badgeId, instituteId);
        if (existing.isEmpty()) return false;

        LearnerBadge badge = existing.get();
        badge.setStatus(LearnerBadgeStatus.REVOKED);
        badge.setRevokedByUserId(revokedByUserId);
        badge.setRevokedAt(new Timestamp(System.currentTimeMillis()));
        learnerBadgeRepository.save(badge);
        return true;
    }

    /** Active awarded badges for a learner (used by both the admin student view and the learner app). */
    public List<LearnerBadgeDTO> getActiveAwardsForUser(String userId, String instituteId) {
        return learnerBadgeRepository
                .findByUserIdAndInstituteIdAndStatus(userId, instituteId, LearnerBadgeStatus.ACTIVE)
                .stream()
                .map(LearnerBadgeDTO::fromEntity)
                .collect(Collectors.toList());
    }

    // ---------------------------------------------------------------- helpers

    /** Runs after the surrounding transaction commits; immediately when there is none (tests, callers without @Transactional). */
    private static void scheduleAfterCommit(Runnable task) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
        } else {
            task.run();
        }
    }

    private void notifyAwarded(String instituteId, List<String> learnerIds, String badgeId,
                               String badgeName, String reason,
                               String awardedByUserId, String awardedByName) {
        try {
            String who = awardedByName != null && !awardedByName.isBlank() ? awardedByName : "Your institute";
            String title = "You earned a badge!";
            String body = who + " awarded you the \"" + badgeName + "\" badge"
                    + (reason != null && !reason.isBlank() ? " — " + reason.trim() : ".");

            Map<String, Object> alertSettings = new HashMap<>();
            alertSettings.put("priority", 2);
            alertSettings.put("isDismissible", true);
            alertSettings.put("showBadge", true);
            alertSettings.put("isActive", true);

            notificationService.createSystemAlertAnnouncement(
                    instituteId,
                    learnerIds,
                    title,
                    body,
                    awardedByUserId != null ? awardedByUserId : "system",
                    awardedByName != null ? awardedByName : "Admin",
                    "ADMIN",
                    alertSettings);

            Map<String, String> pushData = new HashMap<>();
            pushData.put("badgeId", badgeId);
            pushData.put("badgeName", badgeName);
            pushData.put("source", "BADGE_AWARD");

            notificationService.sendPushViaUnified(instituteId, learnerIds, title, body, pushData);
        } catch (Exception e) {
            // Best-effort: the awards are already committed; never fail the award on notification error.
            log.warn("Failed to send badge-award notification to {} learner(s): {}", learnerIds.size(), e.getMessage());
        }
    }

    private static String truncate(String s) {
        return s != null && s.length() > MAX_SNAPSHOT_LENGTH ? s.substring(0, MAX_SNAPSHOT_LENGTH) : s;
    }

    /** An icon token longer than the column is unusable (a data URI, not a name/file id) — drop it rather than store a truncated one. */
    private static String iconOrNull(String icon) {
        return icon != null && icon.length() > MAX_SNAPSHOT_LENGTH ? null : icon;
    }
}
