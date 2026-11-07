package vacademy.io.admin_core_service.features.ai_plans_billing.notify;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.service.BrandModeService;
import vacademy.io.admin_core_service.features.platform_billing.service.NeutralSender;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformPaymentConfigService;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.logging.SentryLogger;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Lifecycle emails of a paid AI plan: payment link, reminders, pre-debit notice, failed debit,
 * benefits paused. (The tax-invoice and credit-note emails are {@code PlatformDocumentMailService}'s.)
 *
 * <p>Brand rules (owner decisions D1/D2), the same as the document emails:
 * <ul>
 *   <li>NEUTRAL institutes: no "Vacademy" anywhere. Links go only to the institute's own admin host;
 *       with none, the email carries no link (never dash.vacademy.io). The sender is
 *       {@code platform_payment_config.billing_from_email / billing_from_name} when set, else the
 *       institute's own brand-free UTILITY_EMAIL sender ({@link NeutralSender}); with neither the
 *       email is not sent (it would go out as "Vacademy Support"). A final guard refuses to send a
 *       NEUTRAL email whose subject, body, sender name or sender address matches /vacademy/i.</li>
 *   <li>VACADEMY institutes: the subject is prefixed with the trade name.</li>
 * </ul>
 * Recipients: the institute email and the billing-profile email, de-duplicated. Never throws.
 */
@Slf4j
@Service
public class AiPlansBillingMailer {

    public enum Kind {
        PAYMENT_LINK, RENEWAL_LINK, UPGRADE_LINK, REMINDER_DUE_SOON, REMINDER_DUE_TODAY, GRACE,
        PRE_DEBIT_NOTICE, DEBIT_FAILED, MANDATE_ACTIVE
    }

    /** Values for one email; amounts are already formatted ("₹5,900"). */
    public record Mail(Kind kind, String instituteId, String planName, String amountDisplay, String payUrl,
            Instant dueAt, Instant linkExpiresAt, Instant debitAt, String method) {}

    static final String BILLING_PATH = "/settings?selectedTab=aiSettings&aiSection=grp-plan";
    static final String VACADEMY_ADMIN_FALLBACK = "https://dash.vacademy.io";
    static final Pattern BRAND = Pattern.compile("vacademy", Pattern.CASE_INSENSITIVE);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a 'IST'",
            Locale.ENGLISH);

    private final InstituteRepository instituteRepository;
    private final BrandModeService brandModeService;
    private final PlatformPaymentConfigService configService;
    private final NotificationService notificationService;
    private final JdbcTemplate jdbc;

    public AiPlansBillingMailer(InstituteRepository instituteRepository, BrandModeService brandModeService,
            PlatformPaymentConfigService configService, NotificationService notificationService, JdbcTemplate jdbc) {
        this.instituteRepository = instituteRepository;
        this.brandModeService = brandModeService;
        this.configService = configService;
        this.notificationService = notificationService;
        this.jdbc = jdbc;
    }

    /** @return the number of recipients it was handed to (0 when skipped or failed). */
    public int send(Mail m) {
        try {
            Institute institute = instituteRepository.findById(m.instituteId()).orElse(null);
            List<String> to = recipients(m.instituteId(), institute);
            if (to.isEmpty()) {
                log.warn("[ai-plans-billing] {} email skipped: institute {} has no email", m.kind(), m.instituteId());
                return 0;
            }
            BrandMode mode = brandModeService.resolve(m.instituteId());
            PlatformPaymentConfig cfg = loadConfig();
            boolean vacademy = mode == BrandMode.VACADEMY;
            String linkBase = brandModeService.adminLinkBase(
                    institute == null ? null : institute.getAdminPortalBaseUrl(), mode);
            if (linkBase == null && vacademy) {
                linkBase = VACADEMY_ADMIN_FALLBACK;
            }
            String tradeName = vacademy && cfg != null && StringUtils.hasText(cfg.getTradeName())
                    ? cfg.getTradeName().trim() : null;
            String support = cfg == null ? null : supportEmail(cfg.getBillingSupportEmail(), mode);
            String fromName = null;
            String fromEmail = null;
            if (!vacademy) {
                NeutralSender.Sender sender = NeutralSender.resolve(cfg, institute,
                        brandModeService::isVacademyOwnedHost).orElse(null);
                if (sender == null) {
                    SentryLogger.logWarning("AI plan billing email withheld: no neutral sender for a NEUTRAL institute",
                            Map.of("institute.id", m.instituteId(), "kind", m.kind().name()));
                    return 0;
                }
                fromName = sender.fromName();
                fromEmail = sender.fromEmail();
            }
            String instituteName = institute == null ? null : institute.getInstituteName();

            String subject = subject(m, tradeName);
            String body = body(m, instituteName, linkBase == null ? null : linkBase + BILLING_PATH, tradeName, support);
            // The sender may carry the platform name (owner decision 2026-10-16, see NeutralSender);
            // subject and body must not.
            if (!vacademy && (BRAND.matcher(subject).find() || BRAND.matcher(body).find())) {
                SentryLogger.logWarning("AI plan billing email withheld: brand word in a NEUTRAL email",
                        Map.of("institute.id", m.instituteId(), "kind", m.kind().name()));
                return 0;
            }
            int sent = 0;
            for (String email : to) {
                notificationService.sendHtmlEmailViaUnified(email, subject, body, m.instituteId(), fromEmail, fromName,
                        "UTILITY_EMAIL");
                sent++;
            }
            return sent;
        } catch (Exception e) {
            log.error("[ai-plans-billing] {} email failed for {}: {}", m.kind(), m.instituteId(), e.getMessage());
            return 0;
        }
    }

    private PlatformPaymentConfig loadConfig() {
        try {
            return configService.load();
        } catch (Exception e) {
            return null;
        }
    }

    List<String> recipients(String instituteId, Institute institute) {
        List<String> out = new ArrayList<>();
        if (institute != null && StringUtils.hasText(institute.getEmail())) {
            out.add(institute.getEmail().trim());
        }
        try {
            for (String r : jdbc.queryForList(
                    "SELECT billing_email FROM platform_billing_profile WHERE institute_id = ?", String.class,
                    instituteId)) {
                if (StringUtils.hasText(r) && r.contains("@")
                        && out.stream().noneMatch(x -> x.equalsIgnoreCase(r.trim()))) {
                    out.add(r.trim());
                }
            }
        } catch (Exception e) {
            log.debug("[ai-plans-billing] billing profile unavailable for {}: {}", instituteId, e.getMessage());
        }
        return out;
    }

    String supportEmail(String configured, BrandMode mode) {
        if (!StringUtils.hasText(configured)) {
            return null;
        }
        String c = configured.trim();
        if (mode != BrandMode.VACADEMY) {
            int at = c.lastIndexOf('@');
            String host = at < 0 ? null : c.substring(at + 1);
            if (host == null || brandModeService.isVacademyOwnedHost(host) || BRAND.matcher(c).find()) {
                return null;
            }
        }
        return c;
    }

    static String neutralText(String s) {
        return !StringUtils.hasText(s) || BRAND.matcher(s).find() ? null : s.trim();
    }

    static String subject(Mail m, String tradeName) {
        String plan = StringUtils.hasText(m.planName()) ? m.planName() : "AI plan";
        String base = switch (m.kind()) {
            case PAYMENT_LINK -> "Payment link for " + plan;
            case RENEWAL_LINK -> plan + " renews on " + date(m.dueAt()) + ": payment link inside";
            case UPGRADE_LINK -> "Payment link for your upgrade to " + plan;
            case REMINDER_DUE_SOON -> "Reminder: " + plan + " renewal is due on " + date(m.dueAt());
            case REMINDER_DUE_TODAY -> plan + " renewal is due today";
            case GRACE -> "Payment overdue: " + plan + " benefits are paused";
            case PRE_DEBIT_NOTICE -> "Upcoming autopay debit of " + m.amountDisplay() + " for " + plan;
            case DEBIT_FAILED -> "Autopay for " + plan + " did not go through: pay by link";
            case MANDATE_ACTIVE -> "Autopay is set up for " + plan;
        };
        return tradeName == null ? base : tradeName + ": " + base;
    }

    static String body(Mail m, String instituteName, String billingLink, String tradeName, String support) {
        String plan = esc(StringUtils.hasText(m.planName()) ? m.planName() : "your AI plan");
        String inst = StringUtils.hasText(instituteName) ? esc(instituteName) : "your institute";
        StringBuilder sb = new StringBuilder(2_000);
        sb.append("<!DOCTYPE html><html><body style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111;\">")
          .append("<div style=\"max-width:560px;margin:24px auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;\">");
        if (tradeName != null) {
            sb.append("<div style=\"font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;\">")
              .append(esc(tradeName)).append("</div>");
        }
        String amount = esc(m.amountDisplay());
        switch (m.kind()) {
            case PAYMENT_LINK -> para(sb, "Here is the payment link for <strong>" + plan + "</strong> for " + inst
                    + ". The plan starts as soon as the payment is received.");
            case UPGRADE_LINK -> para(sb, "Here is the payment link for the upgrade to <strong>" + plan
                    + "</strong>. The new plan applies as soon as the payment is received.");
            case RENEWAL_LINK -> para(sb, "<strong>" + plan + "</strong> for " + inst + " renews on <strong>"
                    + date(m.dueAt()) + "</strong>. Pay before then to keep the plan running without a break.");
            case REMINDER_DUE_SOON -> para(sb, "A reminder that the renewal of <strong>" + plan + "</strong> is due on <strong>"
                    + date(m.dueAt()) + "</strong>.");
            case REMINDER_DUE_TODAY -> para(sb, "The renewal of <strong>" + plan + "</strong> is due today. "
                    + "If it is not paid, plan benefits pause and AI use is charged from credits until it is.");
            case GRACE -> para(sb, "The renewal of <strong>" + plan + "</strong> has not been paid. Plan benefits are "
                    + "paused and AI use is charged from credits. Pay before <strong>" + date(m.linkExpiresAt())
                    + "</strong> to resume the plan; after that it ends.");
            case PRE_DEBIT_NOTICE -> para(sb, "This is a notice that <strong>" + amount + "</strong> will be debited by autopay"
                    + (StringUtils.hasText(m.method()) ? " (" + esc(m.method()) + ")" : "")
                    + " on or after <strong>" + dateTime(m.debitAt()) + "</strong> for the renewal of <strong>" + plan
                    + "</strong>. Nothing to do if that is fine. To stop it, cancel autopay in Plan &amp; billing before then.");
            case DEBIT_FAILED -> para(sb, "The autopay debit for <strong>" + plan + "</strong> did not go through. "
                    + "Please pay with the link below to keep the plan running.");
            case MANDATE_ACTIVE -> para(sb, "Autopay is now set up for <strong>" + plan + "</strong>. Renewals will be "
                    + "debited automatically, with a notice at least 24 hours before each debit.");
        }
        sb.append("<table style=\"width:100%;border-collapse:collapse;margin:16px 0;\">");
        row(sb, "Plan", m.planName());
        row(sb, "Amount (incl. GST)", m.amountDisplay());
        if (m.dueAt() != null && m.kind() != Kind.PAYMENT_LINK && m.kind() != Kind.UPGRADE_LINK) {
            row(sb, "Due on", date(m.dueAt()));
        }
        if (m.linkExpiresAt() != null && StringUtils.hasText(m.payUrl())) {
            row(sb, "Link valid until", dateTime(m.linkExpiresAt()));
        }
        sb.append("</table>");
        if (StringUtils.hasText(m.payUrl())) {
            sb.append("<p style=\"margin:20px 0;\"><a href=\"").append(esc(m.payUrl()))
              .append("\" style=\"background:#111827;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;\">")
              .append("Pay now</a></p>");
        }
        sb.append("<p style=\"color:#6b7280;font-size:13px;margin-top:24px;\">");
        if (StringUtils.hasText(billingLink)) {
            sb.append("See your plan, payments and tax invoices in <a href=\"").append(esc(billingLink))
              .append("\">Plan &amp; billing</a> in your admin dashboard.");
        } else {
            sb.append("See your plan, payments and tax invoices in <strong>Plan &amp; billing</strong> in your admin dashboard.");
        }
        sb.append("</p>");
        if (StringUtils.hasText(support)) {
            sb.append("<p style=\"color:#6b7280;font-size:12px;\">Questions about this bill? Write to ")
              .append(esc(support)).append(".</p>");
        }
        sb.append("</div></body></html>");
        return sb.toString();
    }

    private static void para(StringBuilder sb, String html) {
        sb.append("<p>").append(html).append("</p>");
    }

    private static void row(StringBuilder sb, String label, String value) {
        if (!StringUtils.hasText(value)) {
            return;
        }
        sb.append("<tr><td style=\"padding:6px 0;color:#6b7280;\">").append(esc(label)).append("</td>")
          .append("<td style=\"padding:6px 0;text-align:right;font-weight:600;\">").append(esc(value)).append("</td></tr>");
    }

    static String date(Instant i) {
        return i == null ? "" : DATE.format(i.atZone(IST));
    }

    static String dateTime(Instant i) {
        return i == null ? "" : DATE_TIME.format(i.atZone(IST));
    }

    static String esc(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    /** "₹5,900" / "₹5,900.50" in the Indian grouping. */
    public static String money(long minor, String currency) {
        String symbol = "INR".equalsIgnoreCase(currency) ? "₹" : (currency == null ? "" : currency + " ");
        long rupees = Math.abs(minor) / 100;
        long paise = Math.abs(minor) % 100;
        String digits = Long.toString(rupees);
        StringBuilder grouped = new StringBuilder();
        if (digits.length() > 3) {
            String head = digits.substring(0, digits.length() - 3);
            String tail = digits.substring(digits.length() - 3);
            for (int i = 0; i < head.length(); i++) {
                if (i > 0 && (head.length() - i) % 2 == 0) {
                    grouped.append(',');
                }
                grouped.append(head.charAt(i));
            }
            grouped.append(',').append(tail);
        } else {
            grouped.append(digits);
        }
        return (minor < 0 ? "-" : "") + symbol + grouped + (paise == 0 ? "" : String.format(Locale.ROOT, ".%02d", paise));
    }
}
