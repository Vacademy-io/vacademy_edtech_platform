package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.admin_activity_logs.async.AsyncAuditDispatcher;
import vacademy.io.admin_core_service.features.admin_activity_logs.entity.AdminActivityLog;
import vacademy.io.admin_core_service.features.admin_activity_logs.service.CrmAuditNarrator;
import vacademy.io.admin_core_service.features.audience.entity.LeadTier;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Lead settings → Follow-up fields → "Follow-up interest level updates the lead":
 * the interest level a counsellor records on a follow-up also becomes the lead's own
 * interest level (tier), so the two stop drifting apart.
 *
 * <p>The follow-up's list ("Very Hot" … "Very Cold") is the institute's own wording and is
 * not the tier catalog, so the value is matched to a tier by key ("Very Hot" → VERY_HOT),
 * by label, or by the part of a label in brackets ("Highly Interested (Very Hot)"). A value
 * that matches no tier leaves the lead alone.</p>
 *
 * <p>Runs after the follow-up has committed, in its own transaction: a tier that cannot be
 * set must never undo or fail the follow-up the counsellor just saved.</p>
 *
 * <p>Recorded the same two ways a manual tier change is: on the lead's journey, and in the
 * Admin Activity Log as LEAD / TIER_CHANGE (the manual path gets that row from
 * {@code @Auditable} on its endpoint; this path has no endpoint of its own, so it writes it).</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FollowUpInterestTierSync {

    private static final Pattern BRACKETED = Pattern.compile("\\(([^)]*)\\)\\s*$");

    private final LeadFollowupSettingService settingService;
    private final LeadTierService leadTierService;
    private final UserLeadProfileService userLeadProfileService;
    private final UserLeadProfileRepository userLeadProfileRepository;
    private final TimelineEventService timelineEventService;
    private final PlatformTransactionManager transactionManager;
    private final AsyncAuditDispatcher auditDispatcher;
    private final CrmAuditNarrator crmAuditNarrator;
    private final ObjectMapper objectMapper;

    /** Who changed it and from where, captured on the request thread for the audit row. */
    record Actor(String userId, String fullName, String username,
                 String httpMethod, String endpoint, String ipAddress, String userAgent) {
    }

    /**
     * Set the lead's tier from {@code interestLevel} once the current transaction commits
     * (straight away when there is none). No-op unless the institute turned the switch on,
     * the value maps to a tier, and the lead is not already on it.
     */
    public void syncAfterCommit(String instituteId, String leadUserId, String interestLevel,
                                CustomUserDetails user) {
        if (isBlank(instituteId) || isBlank(leadUserId) || isBlank(interestLevel)) return;
        Actor actor = actorOf(user);
        Runnable sync = () -> syncNow(instituteId, leadUserId, interestLevel, actor);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    sync.run();
                }
            });
        } else {
            sync.run();
        }
    }

    void syncNow(String instituteId, String leadUserId, String interestLevel, Actor actor) {
        try {
            if (!settingService.syncInterestToLead(instituteId)) return;
            String tierKey = resolveTierKey(instituteId, interestLevel);
            if (tierKey == null) {
                log.info("[FollowUpTierSync] '{}' matches no tier for institute {} — lead left as is",
                        interestLevel, instituteId);
                return;
            }
            String current = userLeadProfileRepository.findByUserIdAndInstituteId(leadUserId, instituteId)
                    .map(UserLeadProfile::getLeadTier)
                    .orElse(null);
            if (tierKey.equalsIgnoreCase(Objects.toString(current, ""))) return;

            // afterCommit still sees the finished transaction's resources, so the write needs a
            // fresh one (Spring's TransactionSynchronization#afterCommit contract).
            TransactionTemplate tx = new TransactionTemplate(transactionManager);
            tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            UserLeadProfile profile = tx.execute(s ->
                    userLeadProfileService.updateLeadTier(leadUserId, instituteId, tierKey));
            if (profile == null) return;

            timelineEventService.logJourneyEvent(
                    "USER_LEAD_PROFILE", profile.getId(),
                    LeadJourneyActionType.STATUS_CHANGED,
                    "ADMIN", actor.userId(), actor.username(),
                    "Lead tier set to " + tierKey + " from a follow-up", null,
                    Map.of("tier", tierKey, "source", "FOLLOW_UP_INTEREST_LEVEL",
                            "changed_by", actor.username() != null ? actor.username() : ""),
                    leadUserId);
            recordAudit(instituteId, leadUserId, interestLevel, tierKey, current, actor);
        } catch (Exception e) {
            log.warn("[FollowUpTierSync] could not set tier for lead {} in {}: {}",
                    leadUserId, instituteId, e.getMessage());
        }
    }

    /**
     * The Admin Activity Log row a manual change writes (entity LEAD, action TIER_CHANGE,
     * entity id = the lead's user id), saying it came from a follow-up. Best effort.
     */
    private void recordAudit(String instituteId, String leadUserId, String interestLevel,
                             String tierKey, String previousTier, Actor actor) {
        try {
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("tier", tierKey);
            request.put("source", "FOLLOW_UP_INTEREST_LEVEL");
            request.put("interestLevel", interestLevel);
            Map<String, Object> before = new LinkedHashMap<>();
            before.put("lead_tier", previousTier);
            String lead = Objects.toString(crmAuditNarrator.leadUserFor(leadUserId), leadUserId);
            auditDispatcher.dispatch(AdminActivityLog.builder()
                    .instituteId(instituteId)
                    .actorId(actor.userId())
                    .actorName(actor.fullName())
                    .actorEmail(actor.username())
                    .entityType("LEAD")
                    .entityId(leadUserId)
                    .action("TIER_CHANGE")
                    .httpMethod(actor.httpMethod())
                    .endpoint(truncate(actor.endpoint(), 512))
                    .description("changed lead tier of " + lead + " to " + tierKey + " from a follow-up")
                    .requestPayload(objectMapper.writeValueAsString(request))
                    .beforePayload(objectMapper.writeValueAsString(before))
                    .ipAddress(truncate(actor.ipAddress(), 64))
                    .userAgent(truncate(actor.userAgent(), 512))
                    .responseStatus(200)
                    .build());
        } catch (Exception e) {
            log.warn("[FollowUpTierSync] activity-log entry failed for lead {}: {}", leadUserId, e.getMessage());
        }
    }

    /** Same fields the {@code @Auditable} aspect records, read while still on the request thread. */
    static Actor actorOf(CustomUserDetails user) {
        String method = null, endpoint = null, ip = null, agent = null;
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        if (attrs instanceof ServletRequestAttributes servlet) {
            HttpServletRequest request = servlet.getRequest();
            method = request.getMethod();
            endpoint = request.getRequestURI();
            agent = request.getHeader("User-Agent");
            String forwarded = request.getHeader("X-Forwarded-For");
            String real = request.getHeader("X-Real-IP");
            ip = !isBlank(forwarded) ? forwarded.split(",")[0].trim()
                    : !isBlank(real) ? real : request.getRemoteAddr();
        }
        return new Actor(user != null ? user.getUserId() : null,
                user != null ? user.getFullName() : null,
                user != null ? user.getUsername() : null,
                method, endpoint, ip, agent);
    }

    private static String truncate(String value, int max) {
        return value == null || value.length() <= max ? value : value.substring(0, max);
    }

    /** The tier this interest level names, or null when none does. */
    String resolveTierKey(String instituteId, String interestLevel) {
        String key = normalise(interestLevel);
        if (key.isEmpty()) return null;
        List<LeadTier> tiers = leadTierService.cachedActiveTiers(instituteId);
        for (LeadTier t : tiers) {
            if (key.equals(t.getTierKey())) return t.getTierKey();
        }
        for (LeadTier t : tiers) {
            if (key.equals(normalise(t.getLabel()))) return t.getTierKey();
        }
        for (LeadTier t : tiers) {
            Matcher m = BRACKETED.matcher(Objects.toString(t.getLabel(), ""));
            if (m.find() && key.equals(normalise(m.group(1)))) return t.getTierKey();
        }
        // No catalog match: only a key the institute actually accepts (legacy HOT/WARM/COLD,
        // or an inactive tier still on leads) is safe to set.
        return leadTierService.isKnownTier(instituteId, key) ? key : null;
    }

    /** Same shape as tier keys: "Very  Hot" → VERY_HOT. */
    static String normalise(String value) {
        if (value == null) return "";
        return value.trim().toUpperCase().replaceAll("[^A-Z0-9]+", "_").replaceAll("^_+|_+$", "");
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
