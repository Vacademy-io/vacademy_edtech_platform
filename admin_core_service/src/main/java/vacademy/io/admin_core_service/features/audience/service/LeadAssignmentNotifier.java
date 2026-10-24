package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;

import java.util.List;
import java.util.Map;

/**
 * Bell-icon ("system alert") notifications for counsellor-facing lead events.
 *
 * Every path that writes user_lead_profile.assigned_counselor_id funnels
 * through here so the counsellor hears about new work the same way no matter
 * HOW the lead arrived:
 *   - pool auto-assign            (CounselorAssignmentService)
 *   - manual assign endpoint      (AudienceController)
 *   - CSV/bulk import lead owner  (AudienceService.assignManualCounsellor)
 *   - workbench bulk reassign     (CounsellorReassignService)
 *   - pool backup reassign        (CounselorPoolService.reassignOpenLeadsToBackup)
 *
 * Also rings the owner when one of their leads enquires again (repeat-lead
 * reattempt, {@code AudienceService.recordReattempt}).
 *
 * Also used by {@code LeadAutomationScheduler} for follow-up due/overdue
 * reminders — a guaranteed baseline bell alert, since the workflow-trigger
 * path those events also emit has no bell/system-alert node type and depends
 * on the institute having bound a custom workflow.
 *
 * Best-effort by design: every dispatch is wrapped so a notification-service
 * blip can never fail (or roll back) the assignment that triggered it.
 *
 * Deliberately depends ONLY on the notification client layer — never on the
 * audience / counselor_pool / counsellor_workbench feature services — so it
 * can be injected into all of them without forming a bean cycle.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadAssignmentNotifier {

    /** Same alert settings the original pool auto-assign notification used. */
    private static final Map<String, Object> ALERT_SETTINGS = Map.of(
            "priority", 2,
            "isDismissible", true,
            "showBadge", true,
            "isActive", true);

    /**
     * A new-lead alert that will NOT be dismissed by hand. It comes down when the
     * counsellor actually works the lead — any timeline event on it clears the
     * alert through {@code NotificationService.deactivateSystemAlertsForEntity}.
     * Letting it be swiped away would defeat the only thing it is for.
     */
    private static final Map<String, Object> STICKY_ALERT_SETTINGS = Map.of(
            "priority", 2,
            "isDismissible", false,
            "showBadge", true,
            "isActive", true);

    /** What a lead-assignment alert is filed under, so activity can find it again. */
    public static final String LEAD_ENTITY = "LEAD";

    private final NotificationService notificationService;

    /**
     * One lead assigned to one counsellor. {@code leadName} and
     * {@code campaignName} are both optional — the body degrades gracefully:
     *   - both:          You have a new lead "Asha" from campaign "Spring intake".
     *   - campaign only: You have a new lead from campaign "Spring intake".  (the exact legacy pool-assign text)
     *   - lead only:     You have a new lead "Asha".
     *   - neither:       You have a new lead.
     */
    public void notifyAssigned(String instituteId, String counsellorUserId, String leadName, String campaignName) {
        notifyAssigned(instituteId, counsellorUserId, leadName, campaignName, null);
    }

    /**
     * As above, with the lead's user id. Given one, the alert is filed against
     * that lead and raised as non-dismissible: it sits on the bell until the
     * counsellor logs something on the lead. Without one the old behaviour
     * stands — an ordinary dismissible alert — so a path that cannot name the
     * lead still notifies.
     */
    public void notifyAssigned(String instituteId, String counsellorUserId, String leadName,
                               String campaignName, String leadUserId) {
        if (counsellorUserId == null || counsellorUserId.isBlank()) {
            return;
        }
        StringBuilder body = new StringBuilder("You have a new lead");
        if (leadName != null && !leadName.isBlank()) {
            body.append(" \"").append(leadName).append("\"");
        }
        if (campaignName != null && !campaignName.isBlank()) {
            body.append(" from campaign \"").append(campaignName).append("\"");
        }
        body.append(".");
        boolean sticky = leadUserId != null && !leadUserId.isBlank();
        dispatch(instituteId, counsellorUserId, "New lead assigned", body.toString(),
                sticky ? STICKY_ALERT_SETTINGS : ALERT_SETTINGS,
                sticky ? LEAD_ENTITY : null, sticky ? leadUserId : null);
    }

    /**
     * One of the counsellor's leads enquired again. Filed against the lead and sticky like a
     * new-lead alert when {@code leadUserId} is given. {@code leadName}, {@code sourceLabel}
     * and {@code campaignName} are optional:
     *   "Asha" enquired again via Meta Lead Ads (campaign "Spring intake").
     */
    public void notifyReattempt(String instituteId, String counsellorUserId, String leadName,
                                String sourceLabel, String campaignName, String leadUserId) {
        if (counsellorUserId == null || counsellorUserId.isBlank()) {
            return;
        }
        StringBuilder body = new StringBuilder();
        if (leadName != null && !leadName.isBlank()) {
            body.append("\"").append(leadName).append("\" enquired again");
        } else {
            body.append("Your lead enquired again");
        }
        if (sourceLabel != null && !sourceLabel.isBlank()) {
            body.append(" via ").append(sourceLabel);
        }
        if (campaignName != null && !campaignName.isBlank()) {
            body.append(" (campaign \"").append(campaignName).append("\")");
        }
        body.append(".");
        boolean sticky = leadUserId != null && !leadUserId.isBlank();
        dispatch(instituteId, counsellorUserId, "Reattempt", body.toString(),
                sticky ? STICKY_ALERT_SETTINGS : ALERT_SETTINGS,
                sticky ? LEAD_ENTITY : null, sticky ? leadUserId : null);
    }

    /**
     * N leads moved to one counsellor in a single operation (workbench
     * reassign, pool backup, …). Sends exactly ONE notification — never one
     * per lead — so a 200-lead reassign doesn't bury the target's bell.
     * {@code contextLabel} is an optional human hint appended in parentheses,
     * e.g. {@code workbench reassign} or {@code backup for pool "North"}.
     */
    public void notifyBatchAssigned(String instituteId, String counsellorUserId, int count, String contextLabel) {
        if (counsellorUserId == null || counsellorUserId.isBlank() || count <= 0) {
            return;
        }
        String title = count == 1 ? "Lead reassigned to you" : "Leads reassigned to you";
        StringBuilder body = new StringBuilder()
                .append(count).append(count == 1 ? " lead" : " leads").append(" reassigned to you");
        if (contextLabel != null && !contextLabel.isBlank()) {
            body.append(" (").append(contextLabel).append(")");
        }
        body.append(".");
        dispatch(instituteId, counsellorUserId, title, body.toString());
    }

    /**
     * A counsellor-scheduled follow-up has come due, or gone overdue, for one of
     * their leads. {@code leadName} is optional and degrades gracefully same as
     * {@link #notifyAssigned}.
     */
    public void notifyFollowUpDue(String instituteId, String counsellorUserId, String leadName, boolean overdue) {
        if (counsellorUserId == null || counsellorUserId.isBlank()) {
            return;
        }
        String title = overdue ? "Follow-up overdue" : "Follow-up due";
        StringBuilder body = new StringBuilder(overdue ? "Your follow-up is overdue" : "You have a follow-up due now");
        if (leadName != null && !leadName.isBlank()) {
            body.append(" for \"").append(leadName).append("\"");
        }
        body.append(".");
        dispatch(instituteId, counsellorUserId, title, body.toString());
    }

    private void dispatch(String instituteId, String counsellorUserId, String title, String body) {
        dispatch(instituteId, counsellorUserId, title, body, ALERT_SETTINGS, null, null);
    }

    private void dispatch(String instituteId, String counsellorUserId, String title, String body,
                          Map<String, Object> settings, String entity, String entityId) {
        try {
            notificationService.createSystemAlertAnnouncement(
                    instituteId,
                    List.of(counsellorUserId),
                    title,
                    body,
                    "system",
                    "System",
                    "ADMIN",
                    settings,
                    entity,
                    entityId);
        } catch (Exception e) {
            log.warn("Failed to send lead-assignment notification to counsellor={} (institute={}): {}",
                    counsellorUserId, instituteId, e.getMessage());
        }
    }
}
