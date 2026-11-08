package vacademy.io.notification_service.features.email_billing;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Decides the {@link EmailBillingClass} of an outgoing email.
 *
 * <p>Order: no institute → EXCLUDED; an explicit class from the caller wins; then the caller's
 * {@code options.source}; then a template that carries login credentials. Anything else is
 * BILLABLE, so an email nobody recognised is charged rather than silently free.
 */
public final class EmailBillingClassifier {

    /** Already charged per message by admin-core (credit_pricing engagement_message). */
    static final String ENGAGEMENT_ENGINE_SOURCE = "ENGAGEMENT_ENGINE";

    /**
     * Account access and our own mail to the institute. admin-core's dynamic notifications send
     * as "event:&lt;EVENT&gt;"; the prefix is dropped before matching.
     */
    private static final Set<String> FREE_SOURCES = Set.of(
            "OTP_SERVICE",
            "OTP_REQUEST",
            "AUTH-SERVICE",
            "LEARNER_CREDENTIALS_SHARED",
            "LEARNER_PASSWORD_RESET",
            "GUARDIAN_ACCOUNT_CREATED",
            "TEAM_INVITE",
            "AI_CREDIT_PACK_CONFIRMATION",
            "AI_PLATFORM_INVOICE",
            "AI_PLATFORM_CREDIT_NOTE",
            "AI_PLAN_BILLING",
            "PRODUCT-SIGNUP-ALERT",
            "EMAIL_BILLING_NOTICE");

    /** Proof of payment. */
    private static final Set<String> ESSENTIAL_SOURCES = Set.of(
            "INVOICE",
            "SCHOOL_FEE_RECEIPT",
            "APPLICATION_FEE_RECEIPT",
            "PAYMENT_RECEIPT",
            "PAYMENT_CONFIRMATION",
            "PAYMENT_SUCCESS",
            "FEE_RECEIPT");

    /** Merge tags that only appear in login-credential and password-reset mail. */
    private static final Pattern CREDENTIAL_TAG = Pattern.compile(
            "\\{\\{\\s*(password|user_password|your_password|reset_password_link)\\s*}}",
            Pattern.CASE_INSENSITIVE);

    private EmailBillingClassifier() {
    }

    public static EmailBillingClass classify(String instituteId, EmailBillingClass explicit, String source) {
        return classify(instituteId, explicit, source, null, null);
    }

    /**
     * @param templateSubject subject before merge tags were filled, or null
     * @param templateBody    body before merge tags were filled, or null
     */
    public static EmailBillingClass classify(String instituteId, EmailBillingClass explicit, String source,
            String templateSubject, String templateBody) {
        if (instituteId == null || instituteId.isBlank()) {
            return EmailBillingClass.EXCLUDED;
        }
        if (explicit != null) {
            return explicit;
        }
        String key = source == null ? "" : source.trim().toUpperCase(Locale.ROOT);
        if (key.startsWith("EVENT:")) {
            key = key.substring("EVENT:".length());
        }
        if (ENGAGEMENT_ENGINE_SOURCE.equals(key)) {
            return EmailBillingClass.EXCLUDED;
        }
        if (FREE_SOURCES.contains(key)) {
            return EmailBillingClass.FREE;
        }
        if (ESSENTIAL_SOURCES.contains(key)) {
            return EmailBillingClass.ESSENTIAL;
        }
        if (carriesCredentials(templateSubject) || carriesCredentials(templateBody)) {
            return EmailBillingClass.FREE;
        }
        return EmailBillingClass.BILLABLE;
    }

    static boolean carriesCredentials(String template) {
        return template != null && CREDENTIAL_TAG.matcher(template).find();
    }
}
