package vacademy.io.notification_service.features.email_billing;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.common.auth.entity.User;
import vacademy.io.notification_service.features.announcements.client.AuthServiceClient;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;
import vacademy.io.notification_service.service.EmailService;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Tells an institute about its email allowance: at 80% and 100% of the free emails, and when
 * emails stop because it is out of credits (at most once every 6 hours). Sent as FREE mail, so the
 * notice itself is never blocked, to the institute's contact address, or when it has none to up to
 * five of its admins (many institutes never filled in a contact address).
 */
@Component
@Slf4j
public class EmailBillingNotifier {

    static final String SOURCE = "EMAIL_BILLING_NOTICE";

    private final JdbcTemplate jdbc;
    private final EmailBillingSettings settings;
    private final InstituteInternalService instituteService;
    private final EmailService emailService;
    private final AuthServiceClient authServiceClient;

    /** Admin accounts our own staff hold inside customer institutes; never notice recipients. */
    static final Set<String> INTERNAL_DOMAINS = Set.of("vidyayatan.com", "vacademy.com", "vacademy.io", "vacademy.ai");
    static final int MAX_ADMIN_RECIPIENTS = 5;

    /** Admin dashboard used when the institute has no admin domain of its own. */
    @Value("${email.billing.dashboard-base-url:https://dash.vacademy.io}")
    private String defaultDashboardUrl;

    static final String USAGE_PATH = "/settings?selectedTab=emailUsage";

    public EmailBillingNotifier(JdbcTemplate jdbc, EmailBillingSettings settings,
            InstituteInternalService instituteService, @Lazy EmailService emailService,
            AuthServiceClient authServiceClient) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.instituteService = instituteService;
        this.emailService = emailService;
        this.authServiceClient = authServiceClient;
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

    /**
     * Called by the hourly billing job: 80% and 100% of the free allowance, once each per month.
     * The allowance and price are the institute's own (custom deals differ from the default).
     */
    public void sendAllowanceNotices(EmailBillingSettings.Snapshot s) {
        String month = EmailBillingSettings.currentMonth();
        List<java.util.Map<String, Object>> rows = jdbc.queryForList("""
                SELECT institute_id, chargeable_units, notified_free_80, notified_free_100
                FROM email_billing_month WHERE period_month = ? AND (notified_free_80 = FALSE OR notified_free_100 = FALSE)
                """, month);
        for (java.util.Map<String, Object> r : rows) {
            String instituteId = (String) r.get("institute_id");
            long used = ((Number) r.get("chargeable_units")).longValue();
            long free = s.freeUnits(instituteId);
            String perCredit = emailsPerCredit(s.rate(instituteId));
            if (!Boolean.TRUE.equals(r.get("notified_free_80")) && used >= (long) Math.ceil(free * 0.8)) {
                notice(instituteId, month, "notified_free_80", s,
                        "You have used 80% of this month's free emails",
                        "Your institute has used 80% of its " + free + " free emails for this month.",
                        "After that, emails cost 1 credit per " + perCredit + ". Keep enough credits so they don't pause.");
            }
            if (!Boolean.TRUE.equals(r.get("notified_free_100")) && used >= free) {
                notice(instituteId, month, "notified_free_100", s,
                        "This month's free emails are used up",
                        "Your institute has used all " + free + " free emails for this month.",
                        "Further emails cost 1 credit per " + perCredit + ". If credits run out, emails pause until you add more.");
            }
        }
    }

    /** "25" for 0.04 credit an email, "37" for 0.0269. */
    static String emailsPerCredit(java.math.BigDecimal rate) {
        return String.valueOf(java.math.BigDecimal.ONE.divide(rate, 0, java.math.RoundingMode.DOWN).max(java.math.BigDecimal.ONE));
    }

    /** Claims the flag atomically (one pod, once a month) and sends. */
    private void notice(String instituteId, String month, String flag, EmailBillingSettings.Snapshot s,
            String subject, String line1, String line2) {
        int claimed = jdbc.update("UPDATE email_billing_month SET " + flag + " = TRUE "
                + "WHERE institute_id = ? AND period_month = ? AND " + flag + " = FALSE", instituteId, month);
        if (claimed == 1 && !s.isExempt(instituteId)) {
            send(instituteId, subject, line1, line2);
        }
    }

    private void send(String instituteId, String subject, String line1, String line2) {
        try {
            InstituteInfoDTO info = instituteService.getInstituteByInstituteId(instituteId);
            List<String> recipients = recipients(instituteId, info);
            if (recipients.isEmpty()) {
                log.info("No contact or admin email for institute {}; email billing notice '{}' not sent",
                        instituteId, subject);
                return;
            }
            String name = info != null && info.getInstituteName() != null ? info.getInstituteName() : "your institute";
            // A white-label institute reads its own admin domain, never ours.
            String base = info != null && info.getAdminPortalUrl() != null && !info.getAdminPortalUrl().isBlank()
                    ? info.getAdminPortalUrl().trim() : defaultDashboardUrl;
            if (!base.startsWith("http")) {
                base = "https://" + base;
            }
            String usageUrl = base.replaceAll("/+$", "") + USAGE_PATH;
            String body = "<p>Hello " + escape(name) + ",</p><p>" + escape(line1) + "</p><p>" + escape(line2)
                    + "</p><p><a href=\"" + usageUrl + "\">See email usage and credits</a></p>";
            for (String to : recipients) {
                emailService.sendHtmlEmail(to, subject, SOURCE, body, instituteId, null, null, "UTILITY_EMAIL",
                        null, null, null, null, EmailBillingClass.FREE);
            }
        } catch (Exception e) {
            log.warn("Email billing notice '{}' to institute {} failed: {}", subject, instituteId, e.getMessage());
        }
    }

    /** The contact address; without one, up to five admins, never our own staff accounts. */
    List<String> recipients(String instituteId, InstituteInfoDTO info) {
        if (info != null && info.getEmail() != null && !info.getEmail().isBlank()) {
            return List.of(info.getEmail().trim());
        }
        List<String> out = new ArrayList<>();
        for (User admin : authServiceClient.getUsersByRole(instituteId, "ADMIN")) {
            String email = admin.getEmail() == null ? "" : admin.getEmail().trim().toLowerCase(Locale.ROOT);
            int at = email.lastIndexOf('@');
            if (at < 1 || INTERNAL_DOMAINS.contains(email.substring(at + 1)) || out.contains(email)) {
                continue;
            }
            out.add(email);
            if (out.size() == MAX_ADMIN_RECIPIENTS) {
                break;
            }
        }
        return out;
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
