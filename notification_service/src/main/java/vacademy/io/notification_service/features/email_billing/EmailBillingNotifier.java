package vacademy.io.notification_service.features.email_billing;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;
import vacademy.io.notification_service.service.EmailService;

import java.util.List;

/**
 * Tells an institute about its email allowance: at 80% and 100% of the free emails, and when
 * emails stop because it is out of credits (at most once every 6 hours). Sent as FREE mail to the
 * institute's contact address, so the notice itself is never blocked.
 */
@Component
@Slf4j
public class EmailBillingNotifier {

    static final String SOURCE = "EMAIL_BILLING_NOTICE";

    private final JdbcTemplate jdbc;
    private final EmailBillingSettings settings;
    private final InstituteInternalService instituteService;
    private final EmailService emailService;

    /** Admin dashboard used when the institute has no admin domain of its own. */
    @Value("${email.billing.dashboard-base-url:https://dash.vacademy.io}")
    private String defaultDashboardUrl;

    static final String USAGE_PATH = "/settings?selectedTab=emailUsage";

    public EmailBillingNotifier(JdbcTemplate jdbc, EmailBillingSettings settings,
            InstituteInternalService instituteService, @Lazy EmailService emailService) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.instituteService = instituteService;
        this.emailService = emailService;
    }

    @EventListener
    public void onEmailBlocked(BlockedEmailStore.EmailBlockedEvent event) {
        try {
            if (!settings.get().notifyEnabled() || event.instituteId() == null) {
                return;
            }
            // Claim the notice atomically: only one pod and one send every 6 hours win.
            int claimed = jdbc.update("""
                    INSERT INTO email_billing_month (institute_id, period_month, last_block_notice_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT (institute_id, period_month) DO UPDATE
                        SET last_block_notice_at = CURRENT_TIMESTAMP
                        WHERE email_billing_month.last_block_notice_at IS NULL
                           OR email_billing_month.last_block_notice_at < CURRENT_TIMESTAMP - INTERVAL '6 hours'
                    """, event.instituteId(), EmailBillingSettings.currentMonth());
            if (claimed == 1) {
                send(event.instituteId(), "Emails paused: your institute is out of email credits",
                        "Your institute has used this month's free emails and has no credits left, so emails "
                                + "to learners and staff are paused. Login codes, password resets, login details, "
                                + "receipts and invoices still go out.",
                        "Add credits to restart emails. Emails that were not sent are listed on the Email usage "
                                + "page, where you can resend them.");
            }
        } catch (Exception e) {
            log.warn("Out-of-credits notice for institute {} failed: {}", event.instituteId(), e.getMessage());
        }
    }

    /** Called by the hourly billing job: 80% and 100% of the free allowance, once each per month. */
    public void sendAllowanceNotices(EmailBillingSettings.Snapshot s) {
        String month = EmailBillingSettings.currentMonth();
        long free = s.freeUnitsPerMonth();
        notice(month, "notified_free_80", (long) Math.ceil(free * 0.8),
                "You have used 80% of this month's free emails",
                "Your institute has used 80% of its " + free + " free emails for this month.",
                "After that, emails cost 1 credit per 25. Keep enough credits so they don't pause.");
        notice(month, "notified_free_100", free,
                "This month's free emails are used up",
                "Your institute has used all " + free + " free emails for this month.",
                "Further emails cost 1 credit per 25. If credits run out, emails pause until you add more.");
    }

    private void notice(String month, String flag, long threshold, String subject, String line1, String line2) {
        List<String> institutes = jdbc.queryForList("UPDATE email_billing_month SET " + flag + " = TRUE "
                + "WHERE period_month = ? AND " + flag + " = FALSE AND chargeable_units >= ? RETURNING institute_id",
                String.class, month, threshold);
        for (String instituteId : institutes) {
            if (settings.get().isExempt(instituteId)) {
                continue;
            }
            send(instituteId, subject, line1, line2);
        }
    }

    private void send(String instituteId, String subject, String line1, String line2) {
        try {
            InstituteInfoDTO info = instituteService.getInstituteByInstituteId(instituteId);
            String to = info != null ? info.getEmail() : null;
            if (to == null || to.isBlank()) {
                log.info("No contact email for institute {}; email billing notice '{}' not sent", instituteId, subject);
                return;
            }
            String name = info.getInstituteName() != null ? info.getInstituteName() : "your institute";
            // A white-label institute reads its own admin domain, never ours.
            String base = info.getAdminPortalUrl() != null && !info.getAdminPortalUrl().isBlank()
                    ? info.getAdminPortalUrl().trim() : defaultDashboardUrl;
            if (!base.startsWith("http")) {
                base = "https://" + base;
            }
            String usageUrl = base.replaceAll("/+$", "") + USAGE_PATH;
            String body = "<p>Hello " + escape(name) + ",</p><p>" + escape(line1) + "</p><p>" + escape(line2)
                    + "</p><p><a href=\"" + usageUrl + "\">See email usage and credits</a></p>";
            emailService.sendHtmlEmail(to.trim(), subject, SOURCE, body, instituteId, null, null, "UTILITY_EMAIL",
                    null, null, null, null, EmailBillingClass.FREE);
        } catch (Exception e) {
            log.warn("Email billing notice '{}' to institute {} failed: {}", subject, instituteId, e.getMessage());
        }
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
