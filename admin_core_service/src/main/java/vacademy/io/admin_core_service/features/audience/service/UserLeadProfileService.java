package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.dto.UserAudienceMembershipDTO;
import vacademy.io.admin_core_service.features.audience.dto.UserLeadProfileDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadScore;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.dto.LeadSlaConfigDTO;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatusHistory;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadScoreRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusHistoryRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionLogsRepository;
import vacademy.io.admin_core_service.features.timeline.repository.TimelineEventRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Builds and maintains aggregated lead profiles at the user level.
 *
 * <p>The profile aggregates the best score across all campaigns a user has
 * submitted to within an institute. It is the single source of truth shown
 * in /manage-students and /manage-contacts sidebars.</p>
 *
 * <p>Update triggers:
 * <ol>
 *   <li>Real-time: after any LeadScore save (called by LeadScoringService)</li>
 *   <li>Batch: every 30 minutes via {@link #batchRebuildProfiles()}</li>
 * </ol>
 * </p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserLeadProfileService {

    private final UserLeadProfileRepository userLeadProfileRepository;
    private final AudienceResponseRepository audienceResponseRepository;
    private final PlaceholderEmailService placeholderEmailService;
    private final AudienceRepository audienceRepository;
    private final LeadScoreRepository leadScoreRepository;
    private final LeadStatusRepository leadStatusRepository;
    private final LeadStatusHistoryRepository leadStatusHistoryRepository;
    private final LiveSessionLogsRepository liveSessionLogsRepository;
    private final TimelineEventRepository timelineEventRepository;
    private final WorkflowTriggerService workflowTriggerService;
    private final LeadTriggerContextBuilder leadTriggerContextBuilder;
    private final AuthService authService;
    private final LeadSlaConfigService leadSlaConfigService;
    private final LeadStatusMirrorService leadStatusMirrorService;
    private final LeadTierService leadTierService;

    /**
     * @Lazy breaks the cycle with LeadScoringService (which already injects this
     * service). Spring proxies the bean so it's only resolved on first use.
     */
    @Autowired
    @Lazy
    private LeadScoringService leadScoringService;

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Build or update the lead profile for a single user.
     * Called in real-time after a score is computed.
     *
     * @param userId      Auth user ID (parent or student)
     * @param instituteId Institute the campaign belongs to
     */
    @Transactional
    public UserLeadProfile buildOrUpdateProfile(String userId, String instituteId) {
        if (userId == null || instituteId == null) return null;

        // Load all audience responses for this user (both parent and student roles)
        List<AudienceResponse> responses = audienceResponseRepository
                .findByUserIdOrStudentUserId(userId, userId);

        // Filter to this institute only (responses contain audience_id; we need instituteId match)
        // We derive the institute by reading it from existing lead scores which store instituteId.
        List<String> responseIds = responses.stream()
                .map(AudienceResponse::getId)
                .collect(Collectors.toList());

        List<LeadScore> scores = responseIds.isEmpty()
                ? Collections.emptyList()
                : leadScoreRepository.findByAudienceResponseIdIn(responseIds);

        // Filter scores to this institute
        List<LeadScore> instituteScores = scores.stream()
                .filter(s -> instituteId.equals(s.getInstituteId()))
                .collect(Collectors.toList());

        // Find existing profile or create new
        UserLeadProfile profile = userLeadProfileRepository
                .findByUserIdAndInstituteId(userId, instituteId)
                .orElse(UserLeadProfile.builder()
                        .userId(userId)
                        .instituteId(instituteId)
                        .build());

        // Don't update score if already CONVERTED
        if (!"CONVERTED".equals(profile.getConversionStatus())) {
            updateScoreFields(profile, instituteScores, responses);
        }

        // Always update activity counts
        updateActivityCounts(profile, userId, instituteScores);

        profile.setLastCalculatedAt(new Timestamp(System.currentTimeMillis()));
        profile.setUpdatedAt(new Timestamp(System.currentTimeMillis()));

        return userLeadProfileRepository.save(profile);
    }

    /**
     * Auto-mark conversion on enrollment, but only if a lead profile already exists.
     *
     * Used by the enrollment flow so a user who came in as a lead (had a campaign
     * submission, was contacted, etc.) is automatically removed from open-lead views
     * once they enroll. Users who enroll directly without ever being a lead do not get
     * a profile created — they were never tracked, so there's nothing to convert.
     *
     * Returns true if a profile existed and was marked converted; false otherwise.
     */
    @Transactional
    public boolean markConvertedIfExists(String userId, String instituteId) {
        if (userId == null || instituteId == null) return false;
        return userLeadProfileRepository
                .findByUserIdAndInstituteId(userId, instituteId)
                .map(profile -> {
                    Timestamp now = new Timestamp(System.currentTimeMillis());
                    profile.setConversionStatus("CONVERTED");
                    profile.setConvertedAt(now);
                    // Note: first_response_at is NOT stamped here. TAT is measured strictly as
                    // counsellor-activity time (MIN timeline_event by counsellor), not status flips.
                    profile.setUpdatedAt(now);
                    userLeadProfileRepository.save(profile);
                    return true;
                })
                .orElse(false);
    }

    /**
     * Mark a user's lead as CONVERTED. Freezes score updates.
     * Called by admin when manually marking as converted, or automatically on enrollment.
     */
    @Transactional
    public UserLeadProfile markConverted(String userId, String instituteId) {
        UserLeadProfile profile = userLeadProfileRepository
                .findByUserIdAndInstituteId(userId, instituteId)
                .orElseGet(() -> UserLeadProfile.builder()
                        .userId(userId)
                        .instituteId(instituteId)
                        .build());

        Timestamp now = new Timestamp(System.currentTimeMillis());
        profile.setConversionStatus("CONVERTED");
        profile.setConvertedAt(now);
        // Note: first_response_at is NOT stamped here. TAT is measured strictly as
        // counsellor-activity time (MIN timeline_event by counsellor), not status flips.
        profile.setUpdatedAt(now);
        return userLeadProfileRepository.save(profile);
    }

    /**
     * Update the conversion status of a lead profile.
     * Valid statuses: LEAD, CONVERTED, LOST.
     * Setting to CONVERTED freezes score updates; setting back to LEAD unfreezes them.
     */
    @Transactional
    public UserLeadProfile updateConversionStatus(String userId, String instituteId, String status, String actorUserId) {
        UserLeadProfile profile = userLeadProfileRepository
                .findByUserIdAndInstituteId(userId, instituteId)
                .orElseGet(() -> UserLeadProfile.builder()
                        .userId(userId)
                        .instituteId(instituteId)
                        .build());

        String oldStatus = profile.getConversionStatus();
        status = canonicalStatusKey(instituteId, status);
        Timestamp now = new Timestamp(System.currentTimeMillis());
        profile.setConversionStatus(status);
        profile.setUpdatedAt(now);

        if ("CONVERTED".equals(status)) {
            profile.setConvertedAt(now);
        } else {
            profile.setConvertedAt(null);
        }
        // Note: first_response_at is NOT stamped here. TAT is measured strictly as the time
        // the counsellor took to log their first activity (timeline_event by the assigned
        // counsellor) — status changes by admins don't count toward TAT.

        // Flush the primary write now (rather than letting it flush lazily during a later read):
        // if it ever fails, the real DataAccessException surfaces here and propagates cleanly,
        // instead of being deferred into one of the best-effort catches below and resurfacing at
        // commit as an opaque "Transaction silently rolled back … marked as rollback-only".
        UserLeadProfile saved = userLeadProfileRepository.saveAndFlush(profile);

        // Mirror onto the user's audience_response.lead_status_id so the leads list — which
        // resolves its status as COALESCE(lead_status_id -> key, conversion_status), i.e.
        // prefers the per-response id — reflects this side-view change. Runs in its own
        // REQUIRES_NEW transaction (see LeadStatusMirrorService) so it is genuinely best-effort:
        // a cascade failure rolls back only the mirror, never the status update the admin
        // actually requested.
        try {
            leadStatusMirrorService.syncResponsesLeadStatus(userId, instituteId, status, actorUserId);
        } catch (Exception e) {
            log.warn("Failed to mirror conversion_status onto audience responses for user={} institute={}",
                    userId, instituteId, e);
        }

        emitStatusChanged(saved, "CONVERSION_STATUS", oldStatus, status);
        return saved;
    }

    /**
     * The institute's status key for a status given as a key or a label in any case or spacing
     * ("Call Back", "call-back" → CALL_BACK; "Admission Taken" → CONVERTED). Callers that pass a
     * label would otherwise store it verbatim, and reports would show it as a separate stage.
     * Unknown values are kept as given.
     */
    String canonicalStatusKey(String instituteId, String status) {
        if (status == null || status.isBlank()) return status;
        String wanted = normalizeStatus(status);
        try {
            List<LeadStatus> catalog = leadStatusRepository.findByInstituteIdOrderByDisplayOrderAsc(instituteId);
            for (LeadStatus s : catalog) {
                if (status.equals(s.getStatusKey())) return status;
            }
            for (LeadStatus s : catalog) {
                if (s.getStatusKey() != null && normalizeStatus(s.getStatusKey()).equals(wanted)) return s.getStatusKey();
            }
            for (LeadStatus s : catalog) {
                if (s.getLabel() != null && normalizeStatus(s.getLabel()).equals(wanted)) return s.getStatusKey();
            }
        } catch (Exception e) {
            log.warn("Status catalog lookup failed for institute {}: {}", instituteId, e.getMessage());
        }
        return Set.of("CONVERTED", "LOST", "LEAD").contains(wanted) ? wanted : status;
    }

    static String normalizeStatus(String value) {
        return value.trim().toUpperCase(Locale.ROOT).replaceAll("[\\s_-]+", "_");
    }

    /**
     * Mirror a per-response lead-status change (made from the leads list, which writes
     * audience_response.lead_status_id) onto the user's profile conversion_status, so the
     * side-view — which reads conversion_status — shows the same value.
     *
     * <p>Update-only: never creates a profile. A lead shown in the list has already been
     * scored, so its profile exists; if it somehow doesn't, the list still renders the
     * per-response key and the profile gets created by the next score event. Update-only
     * also avoids the cross-institute INSERT that the global unique on user_lead_profile.user_id
     * would reject.</p>
     *
     * <p>Does NOT emit LEAD_STATUS_CHANGED — the caller (LeadStatusService.changeLeadStatus)
     * already emits it at the response grain, so emitting here would double-fire.</p>
     */
    @Transactional
    public void mirrorConversionStatusFromLead(String userId, String instituteId, String statusKey) {
        if (userId == null || instituteId == null || statusKey == null) return;
        userLeadProfileRepository.findByUserIdAndInstituteId(userId, instituteId).ifPresent(profile -> {
            if (Objects.equals(profile.getConversionStatus(), statusKey)) return; // no-op
            Timestamp now = new Timestamp(System.currentTimeMillis());
            profile.setConversionStatus(statusKey);
            profile.setConvertedAt("CONVERTED".equals(statusKey) ? now : null);
            profile.setUpdatedAt(now);
            userLeadProfileRepository.save(profile);
        });
    }

    /**
     * Manually override the lead tier (HOT, WARM, COLD).
     *
     * Only sets lead_tier — best_score is left intact so the formula's output remains
     * visible alongside the override. Frontends should resolve the active tier as
     * "explicit lead_tier wins, else infer from best_score".
     *
     * Previously this method also wrote best_score = 20/60/90 which silently destroyed
     * the formula output and made it impossible to tell why a profile was at 20.
     */
    @Transactional
    public UserLeadProfile updateLeadTier(String userId, String instituteId, String tier) {
        UserLeadProfile profile = userLeadProfileRepository
                .findByUserIdAndInstituteId(userId, instituteId)
                .orElseGet(() -> UserLeadProfile.builder()
                        .userId(userId)
                        .instituteId(instituteId)
                        .build());

        String oldTier = profile.getLeadTier();
        String requested = tier.trim().toUpperCase();
        if (!leadTierService.isKnownTier(instituteId, requested)) {
            throw new VacademyException("Unknown lead tier: " + requested);
        }
        // Always store what the admin picked. This used to clear lead_tier when the pick
        // matched the current score band ("reset override"), which left the lead on the
        // score: the next rescore moved it to another tier and the admin's Hot / Warm /
        // Cold click appeared not to stick.
        profile.setLeadTier(requested);
        profile.setUpdatedAt(new Timestamp(System.currentTimeMillis()));

        UserLeadProfile saved = userLeadProfileRepository.save(profile);
        emitStatusChanged(saved, "TIER", oldTier, requested);
        return saved;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Workflow trigger emission (emit-only; the workflow engine handles delivery)
    // ─────────────────────────────────────────────────────────────────────────

    /** Emit LEAD_STATUS_CHANGED for a conversion-status or tier change on a user's lead profile. */
    private void emitStatusChanged(UserLeadProfile profile, String changeType, String oldStatus, String newStatus) {
        if (profile == null || Objects.equals(oldStatus, newStatus)) return;
        Map<String, Object> ctx = leadTriggerContextBuilder.forUser(
                profile.getInstituteId(), profile.getUserId(),
                profile.getAssignedCounselorId(), profile.getAssignedCounselorName());
        leadTriggerContextBuilder.put(ctx, "changeType", changeType);
        leadTriggerContextBuilder.put(ctx, "oldStatus", oldStatus);
        leadTriggerContextBuilder.put(ctx, "newStatus", newStatus);
        enrichWithLeadContact(ctx, profile.getUserId());
        enrichTatInfo(ctx, profile.getInstituteId());
        safeEmit(WorkflowTriggerEvent.LEAD_STATUS_CHANGED.name(), profile.getUserId(),
                profile.getInstituteId(), ctx);
    }

    /** Fire a workflow trigger, never letting an automation failure break the lead operation. */
    private void safeEmit(String eventName, String eventId, String instituteId, Map<String, Object> ctx) {
        if (instituteId == null || instituteId.isBlank()) return;
        try {
            workflowTriggerService.handleTriggerEvents(eventName, eventId, instituteId, ctx);
        } catch (Exception ex) {
            log.warn("[LeadTrigger] Failed to emit {} for eventId={}: {}", eventName, eventId, ex.getMessage());
        }
    }

    /**
     * Add the lead's parent contact + pool to a user-grain ctx so communication workflows
     * (SEND_EMAIL / SEND_WHATSAPP) have a recipient — the same fields AUDIENCE_LEAD_SUBMISSION
     * and the TAT scheduler already carry. Sourced from the user's audience_response (prefers
     * one that actually has a contact). Best-effort; never breaks the emit.
     */
    private void enrichWithLeadContact(Map<String, Object> ctx, String userId) {
        if (userId == null || userId.isBlank()) return;
        try {
            // user_lead_profile.user_id can be either the parent or the student (it's the auth
            // user id of whoever the lead is keyed on). audience_response carries them in two
            // separate columns (user_id = parent, student_user_id = student) — query both so
            // we resolve the lead's audience whether this user is the parent OR the student.
            // Without this, student-grain leads silently miss enrichment and the pool-scoped
            // trigger never matches because ctx['poolId'] isn't set.
            List<AudienceResponse> responses =
                    audienceResponseRepository.findByUserIdOrStudentUserId(userId, userId);
            if (responses == null || responses.isEmpty()) {
                // No audience response — still try auth-service so {{parentName}} / {{parentEmail}}
                // resolve to the user's own record (typical for admin-created leads).
                fallbackParentFromAuthService(ctx, userId);
                return;
            }
            // Merge best-available values across all of the user's responses, so a row with a
            // null parent_email doesn't shadow a sibling row that has one. This is what makes
            // {{parentName}} / {{parentEmail}} / {{parentMobile}} resolve in production for
            // leads whose first audience_response wasn't fully populated.
            String parentName = null, parentEmail = null, parentMobile = null;
            String audienceId = null, enquiryId = null, studentUserId = null;
            for (AudienceResponse r : responses) {
                if (parentName == null && r.getParentName() != null && !r.getParentName().isBlank())
                    parentName = r.getParentName();
                if (parentEmail == null && r.getParentEmail() != null && !r.getParentEmail().isBlank())
                    parentEmail = r.getParentEmail();
                if (parentMobile == null && r.getParentMobile() != null && !r.getParentMobile().isBlank())
                    parentMobile = r.getParentMobile();
                if (audienceId == null && r.getAudienceId() != null) audienceId = r.getAudienceId();
                if (enquiryId == null && r.getEnquiryId() != null) enquiryId = r.getEnquiryId();
                if (studentUserId == null && r.getStudentUserId() != null) studentUserId = r.getStudentUserId();
            }
            leadTriggerContextBuilder.put(ctx, "parentName", parentName);
            leadTriggerContextBuilder.put(ctx, "parentEmail", parentEmail);
            leadTriggerContextBuilder.put(ctx, "parentMobile", parentMobile);
            // Cleaner lead-* aliases — for the lead list the lead IS the user, so {{leadName}}
            // reads more naturally than {{parentName}}. Both keys carry the same value.
            leadTriggerContextBuilder.put(ctx, "leadName", parentName);
            leadTriggerContextBuilder.put(ctx, "leadEmail", parentEmail);
            leadTriggerContextBuilder.put(ctx, "leadMobile", parentMobile);
            leadTriggerContextBuilder.put(ctx, "audienceId", audienceId);
            leadTriggerContextBuilder.put(ctx, "enquiryId", enquiryId);
            leadTriggerContextBuilder.put(ctx, "studentUserId", studentUserId);
            leadTriggerContextBuilder.put(ctx, "poolId",
                    leadTriggerContextBuilder.resolvePoolId(audienceId));

            // Look up the campaign name from audience so {{campaignName}} substitutes.
            if (audienceId != null) {
                try {
                    audienceRepository.findById(audienceId).ifPresent(a ->
                            leadTriggerContextBuilder.put(ctx, "campaignName", a.getCampaignName()));
                } catch (Exception ignored) { /* best-effort */ }
            }

            // For any parent_* still missing on the audience_response snapshot, try the live
            // auth-service user record — for admin-created / direct-student leads that's where
            // the name + email + mobile actually live.
            if (parentName == null || parentEmail == null || parentMobile == null) {
                fallbackParentFromAuthService(ctx, userId);
            }
        } catch (Exception e) {
            log.warn("[LeadTrigger] Failed to enrich lead contact for user {}: {}", userId, e.getMessage());
        }
    }

    /**
     * Add {@code tat} (human-readable e.g. "1 hour 30 minutes"), {@code tatMinutes} (exact)
     * and {@code tatHours} (whole hours, rounded up) to ctx so templates can render copy like
     * "Please reach out before {{tat}}". Falls back to a generic "the earliest" string when TAT
     * isn't configured for the institute — that way the template still reads sensibly instead
     * of leaving a literal `tat` placeholder.
     */
    private void enrichTatInfo(Map<String, Object> ctx, String instituteId) {
        String tat = "the earliest";
        Integer tatHours = null;
        Integer tatMinutes = null;
        if (instituteId != null && !instituteId.isBlank()) {
            try {
                LeadSlaConfigDTO config = leadSlaConfigService.getSchedulerConfig(instituteId);
                if (config != null && config.getTatReminder() != null
                        && config.getTatReminder().getTatMinutes() != null) {
                    tatMinutes = config.getTatReminder().getTatMinutes();
                    tatHours = config.getTatReminder().getTatHours();
                    tat = LeadSlaConfigService.formatDuration(tatMinutes);
                }
            } catch (Exception e) {
                log.debug("[LeadTrigger] TAT lookup failed for institute {}: {}",
                        instituteId, e.getMessage());
            }
        }
        leadTriggerContextBuilder.put(ctx, "tat", tat);
        if (tatHours != null) leadTriggerContextBuilder.put(ctx, "tatHours", tatHours);
        if (tatMinutes != null) leadTriggerContextBuilder.put(ctx, "tatMinutes", tatMinutes);
    }

    /**
     * Resolve the lead user's own name/email/mobile from auth-service and fill any
     * parent_* fields the audience_response didn't have. Best-effort; the put() helper
     * is null-safe and won't overwrite values already set.
     */
    private void fallbackParentFromAuthService(Map<String, Object> ctx, String userId) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (users == null || users.isEmpty()) return;
            UserDTO u = users.get(0);
            if (!ctx.containsKey("parentName") && u.getFullName() != null && !u.getFullName().isBlank()) {
                leadTriggerContextBuilder.put(ctx, "parentName", u.getFullName());
                leadTriggerContextBuilder.put(ctx, "leadName", u.getFullName());
            }
            // Skip a synthesized placeholder address (emailless webhook leads — chiefly
            // Meta/Facebook): it's non-deliverable, so a LEAD_STATUS_CHANGED / SLA workflow
            // that emails {{leadEmail}} would bounce. Name + mobile still resolve below, so
            // such leads remain reachable via WhatsApp / phone.
            if (!ctx.containsKey("parentEmail") && u.getEmail() != null && !u.getEmail().isBlank()
                    && !placeholderEmailService.isPlaceholder(u.getEmail())) {
                leadTriggerContextBuilder.put(ctx, "parentEmail", u.getEmail());
                leadTriggerContextBuilder.put(ctx, "leadEmail", u.getEmail());
            }
            if (!ctx.containsKey("parentMobile") && u.getMobileNumber() != null && !u.getMobileNumber().isBlank()) {
                leadTriggerContextBuilder.put(ctx, "parentMobile", u.getMobileNumber());
                leadTriggerContextBuilder.put(ctx, "leadMobile", u.getMobileNumber());
            }
        } catch (Exception e) {
            log.debug("[LeadTrigger] auth-service fallback failed for user {}: {}", userId, e.getMessage());
        }
    }

    /**
     * Rebuild the profile for a user at a specific institute. A user_id can now have a
     * profile per institute, so the caller must supply which one — see class-level
     * uniqueConstraints on UserLeadProfile. Used by event-driven triggers like timeline
     * event inserts.
     *
     * For every audience response the user owns, re-runs the full scoring formula so
     * that newly-added timeline events flow into the engagement component. Without
     * this, buildOrUpdateProfile would just re-aggregate the existing (stale)
     * LeadScore.rawScore values and best_score would never move.
     *
     * Best-effort — no-op if no profile exists yet (the user has never been scored).
     */
    @Transactional
    public void recomputeForUser(String userId, String instituteId) {
        if (userId == null || instituteId == null) return;
        UserLeadProfile profile = userLeadProfileRepository.findByUserIdAndInstituteId(userId, instituteId).orElse(null);
        if (profile == null) return;

        List<AudienceResponse> responses =
                audienceResponseRepository.findByUserIdOrStudentUserId(userId, userId);

        boolean anyRecalculated = false;
        for (AudienceResponse r : responses) {
            try {
                leadScoringService.recalculateScore(r.getId());
                anyRecalculated = true;
            } catch (Exception e) {
                log.warn("Failed to recalculate LeadScore for response {} during user recompute",
                        r.getId(), e);
            }
        }

        // recalculateScore() ends with a buildOrUpdateProfile call (via calculateAndSaveScore),
        // so when responses exist the profile is already up to date. If the user has no
        // responses (e.g. captured outside the campaign flow), still update the profile
        // directly so total_timeline_events reflects the new event.
        if (!anyRecalculated) {
            buildOrUpdateProfile(userId, instituteId);
        }
    }

    /**
     * Fetch the lead profile DTO for a single user.
     */
    public Optional<UserLeadProfileDTO> getProfileDTO(String userId, String instituteId) {
        return userLeadProfileRepository
                .findByUserIdAndInstituteId(userId, instituteId)
                .map(this::toDTO);
    }

    /**
     * Resolve the profile's own id for use as a timeline_event.type_id (which has no
     * institute_id column of its own, so correlating on the raw userId would be ambiguous
     * once a user can have a profile per institute). Falls back to userId if no profile
     * exists yet, matching pre-existing behavior for callers that log events before any
     * profile has been built.
     */
    public String resolveProfileId(String userId, String instituteId) {
        return userLeadProfileRepository.findByUserIdAndInstituteId(userId, instituteId)
                .map(UserLeadProfile::getId)
                .orElse(userId);
    }

    /**
     * Batch fetch profiles for a list of user IDs, scoped to one institute (used by
     * manage-students and manage-contacts). A user_id alone no longer identifies a single
     * profile — see class-level uniqueConstraints on UserLeadProfile.
     */
    public Map<String, UserLeadProfileDTO> getProfilesForUsers(List<String> userIds, String instituteId) {
        if (userIds == null || userIds.isEmpty() || instituteId == null) return Collections.emptyMap();
        return userLeadProfileRepository.findByUserIdInAndInstituteId(userIds, instituteId).stream()
                .collect(Collectors.toMap(
                        UserLeadProfile::getUserId,
                        this::toDTO
                ));
    }

    /**
     * Get a user's audience/campaign memberships within one institute.
     * Returns one entry per audience response the user has submitted there — never
     * another institute's campaigns, even when the same person is a lead in both.
     */
    public List<UserAudienceMembershipDTO> getUserAudienceMemberships(String userId, String instituteId) {
        List<AudienceResponse> responses =
                audienceResponseRepository.findAllByInstituteAndUserOrStudent(instituteId, userId);
        if (responses.isEmpty()) return Collections.emptyList();

        // Batch fetch audience details
        Set<String> audienceIds = responses.stream()
                .map(AudienceResponse::getAudienceId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<String, Audience> audienceMap = audienceRepository.findAllById(audienceIds).stream()
                .collect(Collectors.toMap(Audience::getId, a -> a, (a, b) -> a));

        // Batch fetch lead scores
        List<String> responseIds = responses.stream().map(AudienceResponse::getId).collect(Collectors.toList());
        Map<String, LeadScore> scoreMap = leadScoreRepository.findByAudienceResponseIdIn(responseIds).stream()
                .collect(Collectors.toMap(LeadScore::getAudienceResponseId, s -> s, (a, b) -> a));

        return responses.stream().map(r -> {
            Audience aud = audienceMap.get(r.getAudienceId());
            LeadScore score = scoreMap.get(r.getId());
            return UserAudienceMembershipDTO.builder()
                    .audienceId(r.getAudienceId())
                    .campaignName(aud != null ? aud.getCampaignName() : null)
                    .campaignStatus(aud != null ? aud.getStatus() : null)
                    .responseId(r.getId())
                    .overallStatus(r.getOverallStatus())
                    .audienceStatus(r.getAudienceStatus())
                    .sourceType(r.getSourceType())
                    .submittedAt(r.getSubmittedAt())
                    .leadScore(score != null ? score.getRawScore() : null)
                    .build();
        }).collect(Collectors.toList());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Batch Scheduler
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Batch rebuild all profiles every 30 minutes.
     * Catches up with any changes missed by real-time updates (e.g. percentile recalcs).
     */
    @Scheduled(fixedRate = 30 * 60 * 1000)
    // lockAtLeastFor sits just under the 30-minute rate so the rebuild runs once per interval,
    // not once per replica: with a 1-minute floor the 4 replicas took turns and the rebuild
    // ran back to back (~60 profile writes/s around the clock). See LeadScoringService.
    @SchedulerLock(name = "UserLeadProfileService_batchRebuildProfiles", lockAtMostFor = "PT29M", lockAtLeastFor = "PT29M")
    public void batchRebuildProfiles() {
        log.info("Starting batch user_lead_profile rebuild...");

        // Get all distinct (userId, instituteId) pairs from lead_score via audience_response
        List<LeadScore> allScores = leadScoreRepository.findAll();
        if (allScores.isEmpty()) return;

        // Group score IDs by instituteId
        Map<String, List<String>> byInstitute = allScores.stream()
                .collect(Collectors.groupingBy(
                        LeadScore::getInstituteId,
                        Collectors.mapping(LeadScore::getAudienceResponseId, Collectors.toList())
                ));

        int total = 0;
        for (Map.Entry<String, List<String>> entry : byInstitute.entrySet()) {
            String instituteId = entry.getKey();
            List<String> responseIds = entry.getValue();

            // Fetch responses to get userIds, in chunks rather than one findById per score.
            Set<String> userIds = new HashSet<>();
            for (int i = 0; i < responseIds.size(); i += 1000) {
                List<String> chunk = responseIds.subList(i, Math.min(i + 1000, responseIds.size()));
                for (AudienceResponse r : audienceResponseRepository.findAllById(chunk)) {
                    if (r.getUserId() != null) userIds.add(r.getUserId());
                    if (r.getStudentUserId() != null) userIds.add(r.getStudentUserId());
                }
            }

            for (String userId : userIds) {
                try {
                    buildOrUpdateProfile(userId, instituteId);
                    total++;
                } catch (Exception e) {
                    log.error("Batch rebuild failed for userId={}, instituteId={}", userId, instituteId, e);
                }
            }
        }

        log.info("Batch user_lead_profile rebuild complete. Updated {} profiles.", total);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private void updateScoreFields(
            UserLeadProfile profile,
            List<LeadScore> scores,
            List<AudienceResponse> allResponses) {

        if (scores.isEmpty()) {
            profile.setBestScore(0);
            // Don't write lead_tier here. If an admin has explicitly set it (e.g. HOT
            // for a known interested lead with no submissions yet), recompute should
            // preserve that override. Frontend infers a tier from best_score when
            // lead_tier is null.
            profile.setCampaignCount(0);
            return;
        }

        // Best score
        LeadScore best = scores.stream()
                .max(Comparator.comparingInt(LeadScore::getRawScore))
                .orElse(null);

        if (best != null) {
            profile.setBestScore(best.getRawScore());
            profile.setBestScoreResponseId(best.getAudienceResponseId());
            // Do NOT setLeadTier here — keeping the explicit override (or null) lets the
            // frontend treat "lead_tier present" as a manual override and fall back to
            // best_score-derived tier when it's null. Previously every recompute would
            // overwrite a manual HOT/WARM/COLD click within seconds.

            // Find source type of best response
            allResponses.stream()
                    .filter(r -> r.getId().equals(best.getAudienceResponseId()))
                    .findFirst()
                    .ifPresent(r -> profile.setBestSourceType(r.getSourceType()));
        }

        // Campaign count = distinct audienceIds across scores
        long campaignCount = scores.stream()
                .map(LeadScore::getAudienceId)
                .distinct()
                .count();
        profile.setCampaignCount((int) campaignCount);

        // Last activity = most recent response submission
        allResponses.stream()
                .map(AudienceResponse::getSubmittedAt)
                .filter(Objects::nonNull)
                .max(Comparator.naturalOrder())
                .ifPresent(profile::setLastActivityAt);
    }

    private void updateActivityCounts(
            UserLeadProfile profile,
            String userId,
            List<LeadScore> scores) {

        // Timeline events for this user. Two sources contribute:
        //  1. Cross-stage events (notes, calls, meetings, follow-ups) logged from the
        //     lead-profile drawer — stamped with student_user_id = userId regardless of
        //     the parent entity type (STUDENT / ENQUIRY / APPLICANT).
        //  2. Events tied directly to an audience response (type = "AUDIENCE_RESPONSE")
        //     for users with campaign submissions.
        // Cross-stage events typically don't carry a type='AUDIENCE_RESPONSE' parent,
        // so summing the two counts is safe in practice. If a future emitter sets both
        // student_user_id AND attaches to an audience response, switch to a DISTINCT query.
        try {
            long crossStageCount = timelineEventRepository.countByStudentUserId(userId);

            long responseCount = 0;
            List<String> responseIds = scores.stream()
                    .map(LeadScore::getAudienceResponseId)
                    .collect(Collectors.toList());
            if (!responseIds.isEmpty()) {
                responseCount = timelineEventRepository
                        .countByTypeAndTypeIdIn("AUDIENCE_RESPONSE", responseIds);
            }

            profile.setTotalTimelineEvents((int) (crossStageCount + responseCount));
        } catch (Exception e) {
            log.warn("Failed to count timeline events for userId={}", userId, e);
        }

        // Demo attendance count (ATTENDANCE_RECORDED logs where userSourceId = userId)
        try {
            long attendanceCount = liveSessionLogsRepository
                    .countByUserSourceIdAndLogType(userId, "ATTENDANCE_RECORDED");
            profile.setDemoAttendanceCount((int) attendanceCount);
        } catch (Exception e) {
            log.warn("Failed to count demo attendance for userId={}", userId, e);
        }
    }

    /**
     * Assign a counselor to a user's lead profile (stored at profile level, not per-response).
     *
     * @param userId       Auth user ID of the lead
     * @param instituteId  Institute ID
     * @param counselorId  Auth user ID of the counselor being assigned
     * @param counselorName Display name of the counselor (pass null to clear)
     */
    @Transactional
    public UserLeadProfile assignCounselor(String userId, String instituteId, String counselorId, String counselorName) {
        UserLeadProfile profile = userLeadProfileRepository
                .findByUserIdAndInstituteId(userId, instituteId)
                .orElseGet(() -> UserLeadProfile.builder()
                        .userId(userId)
                        .instituteId(instituteId)
                        .build());

        // Resolve the display name when the caller only knows the id. The column is a
        // denormalised copy and the lead list renders the NAME, so an id written with a
        // null name shows the lead as unassigned however correct the id is -- and on a
        // REassignment it also wipes the name the previous assignment had stored, which
        // is how an owned lead ends up looking ownerless. The AI-call outcome processor
        // is the caller that has only the id (the pool rotation returns a user id), so
        // it relied on this. A genuine un-assignment still clears both, because the
        // backfill only runs when an id is actually being set.
        if (counselorId != null && !counselorId.isBlank()
                && (counselorName == null || counselorName.isBlank())) {
            counselorName = resolveCounselorName(counselorId);
        }

        profile.setAssignedCounselorId(counselorId);
        profile.setAssignedCounselorName(counselorName);
        profile.setUpdatedAt(new Timestamp(System.currentTimeMillis()));
        UserLeadProfile saved = userLeadProfileRepository.save(profile);

        // Emit workflow trigger only on actual assignment (not on clear).
        // Journey event logging (COUNSELOR_ASSIGNED) is done by the caller (AudienceController)
        // to keep TimelineEventService free of circular dependencies.
        if (counselorId != null && !counselorId.isBlank()) {
            Map<String, Object> ctx = leadTriggerContextBuilder.forUser(
                    instituteId, userId, counselorId, counselorName);
            enrichWithLeadContact(ctx, userId);
            enrichTatInfo(ctx, instituteId);
            safeEmit(WorkflowTriggerEvent.LEAD_ASSIGNED_TO_COUNSELOR.name(), userId, instituteId, ctx);
        }
        return saved;
    }

    /**
     * Display name for a counsellor user id, or null when it cannot be resolved.
     *
     * <p>Never throws: a name is cosmetic next to the assignment itself, so a flaky
     * auth-service lookup must not fail the assignment or roll back the transaction
     * it runs in. Returning null simply leaves the column as it would have been.
     */
    private String resolveCounselorName(String counselorId) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(counselorId));
            if (users != null && !users.isEmpty() && users.get(0) != null) {
                String name = users.get(0).getFullName();
                if (name != null && !name.isBlank()) return name;
            }
        } catch (Exception e) {
            log.warn("Could not resolve counsellor name for {}: {}", counselorId, e.getMessage());
        }
        return null;
    }

    private UserLeadProfileDTO toDTO(UserLeadProfile p) {
        return UserLeadProfileDTO.builder()
                .userId(p.getUserId())
                .instituteId(p.getInstituteId())
                .bestScore(p.getBestScore())
                .bestScoreResponseId(p.getBestScoreResponseId())
                .leadTier(p.getLeadTier())
                .conversionStatus(p.getConversionStatus())
                .convertedAt(p.getConvertedAt())
                .campaignCount(p.getCampaignCount())
                .bestSourceType(p.getBestSourceType())
                .totalTimelineEvents(p.getTotalTimelineEvents())
                .demoLoginCount(p.getDemoLoginCount())
                .demoAttendanceCount(p.getDemoAttendanceCount())
                .lastActivityAt(p.getLastActivityAt())
                .lastCalculatedAt(p.getLastCalculatedAt())
                .createdAt(p.getCreatedAt())
                .assignedCounselorId(p.getAssignedCounselorId())
                .assignedCounselorName(p.getAssignedCounselorName())
                .build();
    }
}
