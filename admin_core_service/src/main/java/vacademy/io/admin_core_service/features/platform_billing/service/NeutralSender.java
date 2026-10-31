package vacademy.io.admin_core_service.features.platform_billing.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.common.institute.entity.Institute;

import java.util.Optional;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/**
 * Who a NEUTRAL (white-labelled) billing email may come from (owner D2: nothing says Vacademy,
 * the sender included; critique §C, D3 interim: no neutral sender, no email).
 *
 * <ol>
 *   <li>{@code platform_payment_config.billing_from_email} with {@code billing_from_name}, else the
 *       neutral display name / legal supplier. Owner decision 2026-10-16: this platform sender may
 *       carry the Vacademy name (white-labelled admins may get mail from the Vacademy billing
 *       address); subject and body stay brand-free;</li>
 *   <li>else the institute's OWN {@code UTILITY_EMAIL} sender ({@code setting_json ->
 *       setting.EMAIL_SETTING.data.UTILITY_EMAIL.from}), when it is brand-free: the email is sent
 *       with no from override and notification_service uses that sender;</li>
 *   <li>else none: notification_service would fall back to "Vacademy Support
 *       &lt;support@vacademy.io&gt;", so the caller does not send (the document stays in the
 *       Billing tab) and alerts.</li>
 * </ol>
 */
public final class NeutralSender {

    /** Both null = no override: the institute's own UTILITY_EMAIL sender. */
    public record Sender(String fromEmail, String fromName) {
        public boolean instituteOwn() {
            return fromEmail == null && fromName == null;
        }
    }

    static final Pattern BRAND = Pattern.compile("vacademy", Pattern.CASE_INSENSITIVE);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private NeutralSender() {
    }

    public static Optional<Sender> resolve(PlatformPaymentConfig cfg, Institute institute,
            Predicate<String> vacademyOwnedHost) {
        // Owner decision 2026-10-16: admins of white-labelled institutes may get billing mail from
        // the platform billing sender even when it carries the Vacademy name (e.g. "Billing ·
        // Vacademy" <support@vacademy.io>). Only the sender is exempt; subject and body stay neutral.
        String email = cfg == null ? null : validEmail(cfg.getBillingFromEmail());
        if (email != null) {
            String name = firstText(cfg.getBillingFromName(), cfg.getNeutralDisplayName(), cfg.getSupplierLegalName());
            if (name != null) {
                return Optional.of(new Sender(email, name));
            }
        }
        return instituteOwnSenderIsNeutral(institute, vacademyOwnedHost) ? Optional.of(new Sender(null, null))
                : Optional.empty();
    }

    static boolean instituteOwnSenderIsNeutral(Institute institute, Predicate<String> vacademyOwnedHost) {
        if (institute == null || !StringUtils.hasText(institute.getSetting())) {
            return false;
        }
        try {
            JsonNode from = MAPPER.readTree(institute.getSetting()).path("setting").path("EMAIL_SETTING")
                    .path("data").path("UTILITY_EMAIL").path("from");
            if (!from.isTextual() || !StringUtils.hasText(from.asText())) {
                return false;
            }
            String raw = from.asText().trim();
            String addr = raw;
            String name = null;
            int lt = raw.indexOf('<');
            int gt = raw.indexOf('>');
            if (lt >= 0 && gt > lt) {
                name = raw.substring(0, lt).trim();
                addr = raw.substring(lt + 1, gt).trim();
            }
            return cleanEmail(addr, vacademyOwnedHost) != null && (name == null || !BRAND.matcher(name).find());
        } catch (Exception e) {
            return false;
        }
    }

    static String cleanEmail(String raw, Predicate<String> vacademyOwnedHost) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        String c = raw.trim();
        int at = c.lastIndexOf('@');
        if (at <= 0 || at == c.length() - 1 || BRAND.matcher(c).find()) {
            return null;
        }
        String host = c.substring(at + 1);
        return vacademyOwnedHost != null && vacademyOwnedHost.test(host) ? null : c;
    }

    /** The configured platform sender address, if it looks like an email (brand allowed). */
    static String validEmail(String raw) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        String c = raw.trim();
        int at = c.lastIndexOf('@');
        return at <= 0 || at == c.length() - 1 ? null : c;
    }

    static String firstText(String... names) {
        for (String n : names) {
            if (StringUtils.hasText(n)) {
                return n.trim();
            }
        }
        return null;
    }

    static String firstNeutral(String... names) {
        for (String n : names) {
            if (StringUtils.hasText(n) && !BRAND.matcher(n).find()) {
                return n.trim();
            }
        }
        return null;
    }

    /** True when a sender name / address carries the brand (the mailers' last guard). */
    public static boolean branded(String... values) {
        for (String v : values) {
            if (v != null && BRAND.matcher(v).find()) {
                return true;
            }
        }
        return false;
    }
}
