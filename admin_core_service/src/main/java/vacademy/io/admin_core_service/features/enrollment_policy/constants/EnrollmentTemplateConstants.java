package vacademy.io.admin_core_service.features.enrollment_policy.constants;

import vacademy.io.admin_core_service.features.enrollment_policy.enums.NotificationTriggerType;

/**
 * Constants for enrollment policy email templates.
 * Contains default templates used when custom templates are not found.
 */
public class EnrollmentTemplateConstants {

    /**
     * Default email template subject for expiry notifications.
     * Used when no custom template is found in the Templates table.
     */
    public static final String DEFAULT_EXPIRY_TEMPLATE_SUBJECT = "Your Access to {{course_name}} has Expired";

    /**
     * Default subject for a BEFORE_EXPIRY reminder. Access has not ended yet, so it must not
     * reuse the "has Expired" subject.
     */
    public static final String DEFAULT_BEFORE_EXPIRY_TEMPLATE_SUBJECT = "Your access to {{course_name}} expires on {{expiry_date}}";

    /** Default subject for the given trigger. */
    public static String defaultSubject(NotificationTriggerType trigger) {
        return trigger == NotificationTriggerType.BEFORE_EXPIRY
                ? DEFAULT_BEFORE_EXPIRY_TEMPLATE_SUBJECT
                : DEFAULT_EXPIRY_TEMPLATE_SUBJECT;
    }

    /**
     * Default body for the given trigger, signed with {{institute_name}}. The renew button is
     * only included when there is a renewal link: the link is the institute's own learner
     * portal, and an institute without one gets the text without a button.
     */
    public static String defaultBody(NotificationTriggerType trigger, boolean withRenewalLink) {
        boolean beforeExpiry = trigger == NotificationTriggerType.BEFORE_EXPIRY;
        return "<html><body>" +
                "<p>Hi {{learner_name}},</p>" +
                (beforeExpiry
                        ? "<p>Your access to {{course_name}} expires on {{expiry_date}}.</p>"
                        : "<p>Your access to {{course_name}} has expired on {{expiry_date}}.</p>") +
                (withRenewalLink
                        ? "<p>To continue learning, please renew your subscription: <a href=\"{{renewal_link}}\">Renew Now</a></p>"
                        : "<p>To continue learning, please renew your subscription.</p>") +
                "<p>Thank you!</p>" +
                "<p>{{institute_name}}</p>" +
                "</body></html>";
    }

    private EnrollmentTemplateConstants() {
        // Utility class - prevent instantiation
    }
}

