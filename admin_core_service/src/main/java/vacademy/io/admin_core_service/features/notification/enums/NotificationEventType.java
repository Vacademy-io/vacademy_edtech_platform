package vacademy.io.admin_core_service.features.notification.enums;

public enum NotificationEventType {
    LEARNER_ENROLL("LEARNER_ENROLL"),
    PAYMENT_SUCCESS("PAYMENT_SUCCESS"),
    PAYMENT_FAILED("PAYMENT_FAILED"),
    COURSE_COMPLETED("COURSE_COMPLETED"),
    COURSE_STARTED("COURSE_STARTED"),
    ASSIGNMENT_DUE("ASSIGNMENT_DUE"),
    LIVE_SESSION_REMINDER("LIVE_SESSION_REMINDER"),
    CERTIFICATE_GENERATED("CERTIFICATE_GENERATED"),
    REFERRAL_INVITATION("REFERRAL_INVITATION"),
    AUDIENCE_FORM_SUBMISSION("AUDIENCE_FORM_SUBMISSION"),
    OTP_REQUEST("OTP_REQUEST"),
    APPLICATION_PAYMENT_PENDING("APPLICATION_PAYMENT_PENDING"),
    APPLICATION_FORM_SUBMISSION("APPLICATION_FORM_SUBMISSION"),
    ADMISSION_FORM_SUBMISSION("ADMISSION_FORM_SUBMISSION"),
    ENQUIRY_FORM_SUBMISSION("ENQUIRY_FORM_SUBMISSION"),
    LIVE_CLASS_ON_CREATE("LIVE_CLASS_ON_CREATE"),
    LIVE_CLASS_BEFORE_LIVE("LIVE_CLASS_BEFORE_LIVE"),
    LIVE_CLASS_ON_LIVE("LIVE_CLASS_ON_LIVE"),
    LIVE_CLASS_DELETE("LIVE_CLASS_DELETE"),
    LIVE_CLASS_ON_EDIT("LIVE_CLASS_ON_EDIT"),
    GUARDIAN_ACCOUNT_CREATED("GUARDIAN_ACCOUNT_CREATED"),

    /**
     * A payment was captured and the learner is being told so. Bound per institute AND per
     * channel, so an institute can run its own branded EMAIL body (and later a WhatsApp one)
     * while the seeded DEFAULT config keeps every other institute rendering unchanged.
     */
    PAYMENT_CONFIRMATION("PAYMENT_CONFIRMATION"),
    /**
     * An assessment's results were released: the learner gets their report PDF by email (and by
     * WhatsApp when a template with a document header is bound). Bound per assessment, per
     * institute, or the seeded DEFAULT email, in that order (assessment_service resolves it).
     */
    ASSESSMENT_RESULT_RELEASED("ASSESSMENT_RESULT_RELEASED"),
    /**
     * Sent to a channel partner's admin when the partner's subscription becomes active:
     * login details, the admin-portal link and (when the institute issues one) the
     * Certificate of Affiliation as an attachment. Opt-in per institute via
     * SUB_ORG_ONBOARDING_SETTING.sendWelcomeEmail.
     */
    SUB_ORG_PARTNER_WELCOME("SUB_ORG_PARTNER_WELCOME"),

    /**
     * Transactional emails that predate this enum and were dispatched with no event key at all.
     * They are named here so they can be selected as CC/BCC triggers in notification settings —
     * each value must match the {@code source} its sender stamps on the outgoing send.
     */
    INVOICE("INVOICE"),
    SCHOOL_FEE_RECEIPT("SCHOOL_FEE_RECEIPT"),
    APPLICATION_FEE_RECEIPT("APPLICATION_FEE_RECEIPT"),
    CERTIFICATE_ISSUED("CERTIFICATE_ISSUED"),

    /**
     * Team/admin invitation email (initial + reminder). Sent by auth-service, NOT admin-core —
     * listed here only to keep the event-name catalogue in one place. The value must stay in sync
     * with {@code NotificationConstant.EVENT_TEAM_INVITE} in auth-service.
     */
    TEAM_INVITE("TEAM_INVITE"),

    /**
     * A learner's portal credentials are being handed to them — after an admin
     * edits their username/password, or on an explicit re-share. Bound per
     * institute AND per channel, so an institute can run a branded EMAIL
     * template and a WATI-approved WHATSAPP template off the same event.
     */
    LEARNER_CREDENTIALS_SHARED("LEARNER_CREDENTIALS_SHARED"),

    /**
     * A learner is being sent a link to set a new password themselves, instead of
     * being mailed the password they already have. The template's
     * {@code {{reset_password_link}}} carries the learner's username, so the page it
     * opens knows who is resetting without the learner having to remember it.
     *
     * <p>Separate from {@link #LEARNER_CREDENTIALS_SHARED}: that event hands over a
     * username AND password, this one deliberately hands over neither. An institute
     * that is not allowed to mail plaintext passwords binds this event and leaves the
     * other one unbound.
     */
    LEARNER_PASSWORD_RESET("LEARNER_PASSWORD_RESET");

    private final String value;

    NotificationEventType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
