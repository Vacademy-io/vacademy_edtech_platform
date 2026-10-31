package vacademy.io.notification_service.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.activation.DataHandler;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import jakarta.mail.util.ByteArrayDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.features.announcements.dto.EmailConfigDTO;
import vacademy.io.notification_service.features.announcements.service.EmailConfigurationService;
import vacademy.io.notification_service.features.announcements.service.InstituteAnnouncementSettingsService;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.notification_service.features.bounced_emails.service.BouncedEmailService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.util.EmailDomainBlocklistUtil;

import java.time.Instant;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.time.LocalDateTime;
import vacademy.io.notification_service.features.email_sending_controls.dto.EmailSendingStatusDTO;
import vacademy.io.notification_service.features.email_sending_controls.entity.DeferredEmail;
import vacademy.io.notification_service.features.email_sending_controls.service.DeferredEmailService;
import vacademy.io.notification_service.features.email_sending_controls.service.EmailDailyQuotaService;
import vacademy.io.notification_service.features.email_sending_controls.service.EmailUnsubscribeService;
import vacademy.io.notification_service.features.email_sending_controls.service.SenderPolicy;
import vacademy.io.notification_service.features.email_sending_controls.service.UnsubscribeMailer;

@Service
public class EmailService {

    private static final Logger logger = LoggerFactory.getLogger(EmailService.class);
    private final JavaMailSender mailSender;
    private final EmailDispatcher emailDispatcher;
    @Value("${app.ses.sender.email}")
    private String from;

    // Dedicated SES SMTP credentials used to send from institute-verified custom senders.
    // A verified sender stores placeholder SMTP creds (SMTP_USERNAME/SMTP_PASSWORD); rather than
    // baking real credentials into each institute's settings (which the settings API would expose),
    // the send is routed through THIS account — the same AWS account/region where custom identities
    // are verified. Sourced from env only. Empty username => feature off, behaviour unchanged.
    @Value("${app.ses.sender.smtp.host:${spring.mail.host:}}")
    private String verifiedSenderSmtpHost;
    @Value("${app.ses.sender.smtp.port:${spring.mail.port:2587}}")
    private int verifiedSenderSmtpPort;
    @Value("${app.ses.sender.smtp.username:}")
    private String verifiedSenderSmtpUsername;
    @Value("${app.ses.sender.smtp.password:}")
    private String verifiedSenderSmtpPassword;

    @Value("${ses.configuration.set}")
    private String sesConfigurationSet;

    @Value("${aws.sqs.enabled}")
    private boolean awsSqsEnabled;

    private final InstituteInternalService internalService;
    private final EmailConfigurationService emailConfigurationService;
    private final ObjectMapper objectMapper;
    private final InstituteAnnouncementSettingsService instituteAnnouncementSettingsService;
    private final BouncedEmailService bouncedEmailService;
    private final NotificationLogRepository notificationLogRepository;
    // Sending controls: per-sender daily cap (+ overflow queue) and recipient opt-outs.
    private final EmailDailyQuotaService emailDailyQuotaService;
    private final DeferredEmailService deferredEmailService;
    private final EmailUnsubscribeService emailUnsubscribeService;
    private final UnsubscribeMailer unsubscribeMailer;

    @Autowired
    public EmailService(JavaMailSender mailSender, InstituteInternalService internalService,
            ObjectMapper objectMapper, EmailDispatcher emailDispatcher,
            InstituteAnnouncementSettingsService instituteAnnouncementSettingsService,
            EmailConfigurationService emailConfigurationService,
            BouncedEmailService bouncedEmailService,
            NotificationLogRepository notificationLogRepository,
            EmailDailyQuotaService emailDailyQuotaService,
            DeferredEmailService deferredEmailService,
            EmailUnsubscribeService emailUnsubscribeService,
            UnsubscribeMailer unsubscribeMailer) {
        this.emailDailyQuotaService = emailDailyQuotaService;
        this.deferredEmailService = deferredEmailService;
        this.emailUnsubscribeService = emailUnsubscribeService;
        this.unsubscribeMailer = unsubscribeMailer;
        this.mailSender = mailSender;
        this.internalService = internalService;
        this.objectMapper = objectMapper;
        this.emailDispatcher = emailDispatcher;
        this.instituteAnnouncementSettingsService = instituteAnnouncementSettingsService;
        this.emailConfigurationService = emailConfigurationService;
        this.bouncedEmailService = bouncedEmailService;
        this.notificationLogRepository = notificationLogRepository;
    }

    /**
     * Check if an email should be blocked from sending.
     * Checks both domain blocklist and bounced email blocklist.
     * 
     * @param email The email address to check
     * @return true if the email should be blocked, false otherwise
     */
    private boolean isEmailBlocked(String email) {
        // Check domain blocklist first (faster, static check)
        if (EmailDomainBlocklistUtil.isEmailDomainBlocked(email)) {
            logger.info("Email blocked - domain is in blocklist: {}", email);
            return true;
        }
        
        // Check bounced email blocklist (database check with caching)
        if (bouncedEmailService.isEmailBlocked(email)) {
            logger.info("Email blocked - previously bounced: {}", email);
            return true;
        }

        return false;
    }

    /**
     * Attach copy recipients (CC/BCC) to an outgoing message. Shared by every send path that
     * supports copies.
     *
     * <p>Each address is run through {@link #isEmailBlocked} exactly like the primary recipient:
     * a bounced or blocklisted staff address must never be re-mailed, or it silently degrades the
     * SES reputation of EVERY send that carries the copy.
     *
     * <p>Defaults to BCC. Copies are typically internal staff (accounts@, admissions@) and putting
     * them in a visible CC exposes internal addresses on a learner-facing receipt — callers must
     * opt in to "CC" deliberately.
     *
     * <p>Never throws: a malformed configured address degrades to "no copies" rather than failing
     * the primary send, which would turn a settings typo into an enrollment/payment email outage.
     */
    private void applyCopyRecipients(MimeMessage message, List<String> cc, String ccMode) {
        if (cc == null || cc.isEmpty()) {
            return;
        }
        try {
            List<String> clean = cc.stream()
                    .filter(StringUtils::hasText)
                    .map(String::trim)
                    .distinct()
                    .filter(address -> !isEmailBlocked(address))
                    .toList();
            if (clean.isEmpty()) {
                return;
            }
            Message.RecipientType type = "CC".equalsIgnoreCase(ccMode)
                    ? Message.RecipientType.CC
                    : Message.RecipientType.BCC;
            message.setRecipients(type, InternetAddress.parse(String.join(",", clean)));
            logger.info("Attached {} copy recipient(s) as {}", clean.size(), type);
        } catch (Exception e) {
            logger.warn("Failed to attach copy recipients {} — sending without copies: {}", cc, e.getMessage());
        }
    }

    /**
     * Save email notification log to database.
     * This is required for bounce event processing to link bounce events back to original emails.
     * 
     * @param to Recipient email address
     * @param subject Email subject
     * @param body Email body/content
     * @param source Source of the email (e.g., "EMAIL_SERVICE", "OTP_SERVICE")
     * @param sourceId Optional source ID
     * @param userId Optional user ID
     */
    private void saveEmailNotificationLog(String to, String subject, String body, String source, String sourceId, String userId, String fromEmail) {
        saveEmailNotificationLog(to, subject, body, source, sourceId, userId, fromEmail, null);
    }

    private void saveEmailNotificationLog(String to, String subject, String body, String source, String sourceId, String userId, String fromEmail, String instituteId) {
        saveEmailNotificationLog(to, subject, body, source, sourceId, userId, fromEmail, instituteId, null);
    }

    private void saveEmailNotificationLog(String to, String subject, String body, String source, String sourceId, String userId, String fromEmail, String instituteId, String correlationId) {
        try {
            NotificationLog notificationLog = new NotificationLog();
            notificationLog.setId(UUID.randomUUID().toString());
            notificationLog.setNotificationType("EMAIL");
            notificationLog.setChannelId(to); // Email address (recipient — institute's counterparty)
            notificationLog.setBody(body != null ? body : subject); // Use body if available, otherwise subject
            notificationLog.setSource(source != null ? source : "EMAIL_SERVICE");
            notificationLog.setSourceId(sourceId);
            notificationLog.setUserId(userId);
            // Institute-side address (the sender). Mirrors how WhatsApp uses sender_business_channel_id
            // for the institute's WA business number — lets us scope inbox/stats by institute.
            // Normalize "Display Name <email>" → email so it matches the address list returned by
            // EmailConfigurationService.getInstituteConfiguredFromAddresses (which also extracts).
            String normalizedFrom = normalizeFromAddress(fromEmail);
            if (normalizedFrom != null) {
                notificationLog.setSenderBusinessChannelId(normalizedFrom);
            }
            if (instituteId != null && !instituteId.isBlank()) {
                notificationLog.setInstituteId(instituteId);
            }
            // Caller correlation key (e.g. Engagement Engine action id). sourceId stays the
            // JavaMail Message-ID — inbound reply linking joins on it and must not be displaced.
            notificationLog.setCorrelationId(correlationId);
            // Body holds the HTML, so the subject line would otherwise be lost. The inbox and
            // timeline read it back from message_payload ({"subject": ...}); INBOUND_EMAIL rows use
            // the same key in their richer payload, so one reader covers both.
            String subjectPayload = subjectPayload(objectMapper, subject);
            if (subjectPayload != null) {
                notificationLog.setMessagePayload(subjectPayload);
            }
            notificationLog.setNotificationDate(Instant.now());

            notificationLogRepository.save(notificationLog);
            logger.debug("Saved email notification log for: {} with ID: {}", to, notificationLog.getId());
        } catch (Exception e) {
            // Log error but don't fail email sending if log save fails
            logger.error("Failed to save email notification log for: {} - Error: {}", to, e.getMessage(), e);
        }
    }

    /**
     * Key under which the subject is stored in {@code message_payload} for outbound EMAIL rows —
     * and the key INBOUND_EMAIL rows use in their richer payload. The inbox reader
     * (EmailInboxService / EmailThreadMerger) looks the subject up by this constant.
     */
    public static final String SUBJECT_PAYLOAD_KEY = "subject";

    /** {@code {"subject": ...}} JSON for a non-blank subject; null when there is nothing to store. */
    static String subjectPayload(ObjectMapper objectMapper, String subject) {
        if (subject == null || subject.isBlank()) return null;
        try {
            return objectMapper.writeValueAsString(Map.of(SUBJECT_PAYLOAD_KEY, subject));
        } catch (Exception e) {
            logger.debug("Could not serialise subject payload: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Extracts the bare email address from a possibly-formatted "From" value.
     * Returns lowercased, trimmed email for {@code "support@x.com"}, {@code "Display Name <support@x.com>"},
     * or {@code "  Support <SUPPORT@X.com>  "}. Returns null for null/blank input.
     *
     * Public so AnnouncementDeliveryService and other write paths apply the same normalization.
     */
    /** The display name in a "Name <addr>" from-string, or null when there is none. */
    static String displayNameOf(String raw) {
        if (raw == null) return null;
        int lt = raw.indexOf('<');
        if (lt <= 0) return null;
        String name = raw.substring(0, lt).trim().replaceAll("^\"|\"$", "");
        return name.isEmpty() ? null : name;
    }

    public static String normalizeFromAddress(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty()) return null;
        int lt = s.indexOf('<');
        int gt = s.lastIndexOf('>');
        if (lt >= 0 && gt > lt) {
            String inner = s.substring(lt + 1, gt).trim();
            if (!inner.isEmpty()) return inner.toLowerCase();
        }
        return s.toLowerCase();
    }

    /**
     * The display name to put on the From header. An explicit {@code customFromName} wins. A caller
     * that passes only a bare {@code customFromEmail} (the inbox reply path sends the address with no
     * name) still gets the name stored in the config's "Name <addr>" from-string when that address IS
     * the configured sender — otherwise mail clients show the local-part ("neeraj") as the sender.
     * A formatted custom address ("X <a@b>") is left alone; InternetAddress parses its own name.
     */
    static String resolveFromName(String customFromEmail, String customFromName, String configuredFrom) {
        if (customFromName != null && !customFromName.trim().isEmpty()) {
            return customFromName;
        }
        if (customFromEmail == null || customFromEmail.indexOf('<') >= 0) {
            return null;
        }
        String custom = normalizeFromAddress(customFromEmail);
        if (custom == null || !custom.equals(normalizeFromAddress(configuredFrom))) {
            return null;
        }
        return displayNameOf(configuredFrom);
    }

    /**
     * Builds a mail sender from the dedicated verified-sender SES SMTP credentials (env-provided).
     * Lets an institute send from its SES-verified custom address without storing SMTP credentials
     * in that institute's settings. Mirrors the TLS/timeout properties of {@link #createCustomMailSender}.
     */
    private JavaMailSenderImpl createVerifiedSenderMailSender() {
        JavaMailSenderImpl mailSender = new JavaMailSenderImpl();
        mailSender.setHost(verifiedSenderSmtpHost);
        mailSender.setPort(verifiedSenderSmtpPort);
        mailSender.setUsername(verifiedSenderSmtpUsername);
        mailSender.setPassword(verifiedSenderSmtpPassword);

        Properties props = mailSender.getJavaMailProperties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true");
        props.put("mail.smtp.starttls.required", "true");
        props.put("mail.debug", "false");
        props.put("mail.smtp.connectiontimeout", "10000");
        props.put("mail.smtp.timeout", "10000");
        props.put("mail.smtp.writetimeout", "10000");
        props.put("mail.smtp.ssl.checkserveridentity", "true");
        props.put("mail.smtp.quitwait", "false");
        mailSender.setJavaMailProperties(props);
        return mailSender;
    }

    private JavaMailSenderImpl createCustomMailSender(JsonNode emailSettings) {
        JavaMailSenderImpl mailSender = new JavaMailSenderImpl();
        mailSender.setHost(emailSettings.path(NotificationConstants.HOST).asText());
        mailSender.setPort(emailSettings.path(NotificationConstants.PORT).asInt(2587));
        mailSender.setUsername(emailSettings.path(NotificationConstants.USERNAME).asText());
        mailSender.setPassword(emailSettings.path(NotificationConstants.PASSWORD).asText());

        // Add these properties for TLS
        Properties props = mailSender.getJavaMailProperties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true"); // This is the key part
        props.put("mail.debug", "false");

        // Connection timeout settings to prevent [EOF] authentication failures
        props.put("mail.smtp.connectiontimeout", "10000"); // 10 seconds to establish connection
        props.put("mail.smtp.timeout", "10000"); // 10 seconds for read operations
        props.put("mail.smtp.writetimeout", "10000"); // 10 seconds for write operations

        // Prevent using stale connections that cause EOF errors
        props.put("mail.smtp.ssl.checkserveridentity", "true");
        props.put("mail.smtp.starttls.required", "true");

        // Connection pool management - close connections after each send to avoid stale
        // connections
        props.put("mail.smtp.quitwait", "false"); // Don't wait for server response on QUIT command

        mailSender.setJavaMailProperties(props);
        return mailSender;
    }

    /**
     * (mailSender, from) as before, plus the raw EMAIL_SETTING.data.<type> node it was
     * resolved from (null when the platform default is used) so callers can read the
     * sender's sending controls without a second institute lookup.
     */
    static final class ResolvedSender extends AbstractMap.SimpleEntry<JavaMailSender, String> {
        private final JsonNode node;
        ResolvedSender(JavaMailSender sender, String from, JsonNode node) {
            super(sender, from);
            this.node = node;
        }
        JsonNode node() { return node; }
    }

    /**
     * Get mail sender config with specific email type
     * Falls back to UTILITY_EMAIL if emailType is not provided
     */
    private ResolvedSender getMailSenderConfig(String instituteId, String emailType) {
        JavaMailSender mailSenderToUse = mailSender;
        String fromToUse = from;
        JsonNode resolvedNode = null;

        if (StringUtils.hasText(instituteId)) {
            InstituteInfoDTO institute = internalService.getInstituteByInstituteId(instituteId);
            try {
                if (institute != null && institute.getSetting() != null) {
                    JsonNode settings = objectMapper.readTree(institute.getSetting());

                    // Determine which email type to use - default to UTILITY_EMAIL if not specified
                    String emailTypeToUse = StringUtils.hasText(emailType) ? emailType
                            : NotificationConstants.UTILITY_EMAIL;

                    JsonNode emailSettingsData = settings
                            .path(NotificationConstants.SETTING)
                            .path(NotificationConstants.EMAIL_SETTING)
                            .path(NotificationConstants.DATA);

                    JsonNode emailConfig = emailSettingsData.path(emailTypeToUse);

                    if (!emailConfig.isMissingNode()) {
                        resolvedNode = emailConfig;
                        logger.info("Found email configuration for type: {} in institute: {}", emailTypeToUse,
                                instituteId);

                        // If this sender was set up via the SES self-serve flow but its identity
                        // is not verified yet, sending from it would be rejected by SES. Fall back
                        // to the platform default sender so mail still goes out. Backward compatible:
                        // legacy configs have no "verified" field, so this never triggers for them.
                        JsonNode verifiedNode = emailConfig.path(NotificationConstants.VERIFIED);
                        if (verifiedNode.isBoolean() && !verifiedNode.asBoolean()) {
                            logger.warn("Sender for type {} in institute {} is not SES-verified yet; "
                                    + "falling back to default sender {}", emailTypeToUse, instituteId, from);
                            return new ResolvedSender(mailSender, from, emailConfig);
                        }

                        // Check if SMTP credentials are real or dummy placeholders
                        String username = emailConfig.path(NotificationConstants.USERNAME).asText("");
                        String password = emailConfig.path(NotificationConstants.PASSWORD).asText("");

                        boolean isDummyCredentials = isDummySMTPCredentials(username, password);

                        if (isDummyCredentials) {
                            boolean isVerifiedSender = verifiedNode.isBoolean() && verifiedNode.asBoolean();
                            if (isVerifiedSender && StringUtils.hasText(verifiedSenderSmtpUsername)) {
                                // SES-verified custom sender with placeholder creds: authenticate through
                                // the dedicated SES account (env-provided) where this identity is verified,
                                // instead of the platform default sender which may be a different account
                                // that can't send from the custom address (and would fall back to support@).
                                logger.info("Routing verified sender for type {} via dedicated SES SMTP account",
                                        emailTypeToUse);
                                mailSenderToUse = createVerifiedSenderMailSender();
                            } else {
                                logger.info("Dummy SMTP credentials detected in {}, using default SMTP from environment",
                                        emailTypeToUse);
                                // Use default mail sender from Spring but override 'from' address from JSON
                                mailSenderToUse = mailSender;
                            }
                        } else {
                            logger.info("Real SMTP credentials found in {}, using custom SMTP configuration",
                                    emailTypeToUse);
                            // Use custom SMTP configuration from JSON
                            mailSenderToUse = createCustomMailSender(emailConfig);
                        }

                        // Always use the 'from' address from the email type configuration
                        fromToUse = resolveFromAddress(emailConfig, from);
                        logger.info("Using from address: {} from email type: {}", fromToUse, emailTypeToUse);

                    } else {
                        logger.warn("Email type {} not found in settings, trying UTILITY_EMAIL fallback",
                                emailTypeToUse);
                        // Fallback to UTILITY_EMAIL if specified type not found
                        if (!emailTypeToUse.equals(NotificationConstants.UTILITY_EMAIL)) {
                            return getMailSenderConfig(instituteId, NotificationConstants.UTILITY_EMAIL);
                        }
                        logger.info("No custom SMTP settings found, using default SMTP");
                    }
                }
            } catch (Exception e) {
                logger.error("Error parsing institute email settings for instituteId: {}. Using default SMTP.",
                        instituteId, e);
                // Continue with default settings instead of throwing
            }
        } else {
            logger.info("No instituteId provided, using default SMTP");
        }

        return new ResolvedSender(mailSenderToUse, fromToUse, resolvedNode);
    }

    /**
     * Legacy method for backward compatibility - uses UTILITY_EMAIL by default
     */
    private ResolvedSender getMailSenderConfig(String instituteId) {
        return getMailSenderConfig(instituteId, null);
    }

    /**
     * Check if SMTP credentials are dummy placeholders
     */
    private boolean isDummySMTPCredentials(String username, String password) {
        if (!StringUtils.hasText(username) || !StringUtils.hasText(password)) {
            return true;
        }

        // List of dummy/placeholder values
        String[] dummyValues = {
                "SMTP_USERNAME", "SMTP_PASSWORD",
                "your_username", "your_password",
                "username", "password",
                "placeholder", "dummy",
                "changeme", "change_me",
                "example", "test"
        };

        for (String dummy : dummyValues) {
            if (username.equalsIgnoreCase(dummy) || password.equalsIgnoreCase(dummy)) {
                logger.debug("Detected dummy credential: username={}, password={}", username, password);
                return true;
            }
        }

        return false;
    }

    /**
     * Determines if SES Configuration Set header should be included for email tracking.
     * 
     * The header is included if:
     * 1. AWS SQS is enabled (required for bounce detection/blocklist feature), OR
     * 2. The original institute tracking logic allows it (preserves existing business logic)
     * 
     * This ensures bounce detection works globally while preserving existing institute preferences.
     */
    private boolean shouldIncludeSesConfigurationHeader(String instituteId) {
        if (!awsSqsEnabled) {
            return false;
        }

        // Original logic: check institute tracking preferences
        if (!StringUtils.hasText(instituteId)) {
            return true;
        }

        try {
            return instituteAnnouncementSettingsService.isEmailTrackingEnabled(instituteId);
        } catch (Exception e) {
            logger.warn("Failed to resolve email tracking setting for institute {}: {}", instituteId, e.getMessage());
            return true;
        }
    }

    public void sendEmail(String to, String subject, String text, String instituteId) {
        try {
            // Check if email is blocked (domain blocklist or bounced email blocklist)
            if (isEmailBlocked(to)) {
                logger.info("Skipping simple email for blocked email address: {}", to);
                return;
            }

            AbstractMap.SimpleEntry<JavaMailSender, String> config = getMailSenderConfig(instituteId);
            JavaMailSender mailSenderToUse = config.getKey();
            String fromToUse = config.getValue();

            // Use MimeMessage to support SES configuration set header
            MimeMessage message = new MimeMessage(Session.getInstance(new Properties()));
            message.setRecipient(Message.RecipientType.TO, new InternetAddress(to));
            message.setFrom(new InternetAddress(fromToUse));
            message.setSubject(subject);
            message.setText(text);

            // Add SES configuration set header for event tracking
            if (shouldIncludeSesConfigurationHeader(instituteId)) {
                message.setHeader("X-SES-CONFIGURATION-SET", sesConfigurationSet);
            }

            mailSenderToUse.send(message);
            logger.info("Email sent successfully to {} using {}", to,
                    StringUtils.hasText(instituteId) ? "custom SMTP" : "default SMTP");

            String messageId = null;
            try { messageId = message.getMessageID(); } catch (Exception ignored) {}
            saveEmailNotificationLog(to, subject, text, "EMAIL_SERVICE", messageId, null, fromToUse);

        } catch (Exception e) {
            logger.error("Failed to send email", e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send simple email")
                    .withTag("notification.type", "EMAIL")
                    .withTag("email.type", "SIMPLE")
                    .withTag("recipient.email", to)
                    .withTag("institute.id", instituteId != null ? instituteId : "unknown")
                    .withTag("operation", "sendEmail")
                    .send();
            throw new RuntimeException(e);
        }
    }

    public void sendEmailOtp(String to, String subject, String service, String name, String otp, String instituteId) {
        try {
            // Check if email is blocked (domain blocklist or bounced email blocklist)
            if (isEmailBlocked(to)) {
                logger.info("Skipping OTP email for blocked email address: {}", to);
                return;
            }

            AbstractMap.SimpleEntry<JavaMailSender, String> config = getMailSenderConfig(instituteId);
            JavaMailSender mailSenderToUse = config.getKey();
            String fromToUse = config.getValue();
            InstituteInfoDTO instituteInfoDTO = null;

            if (instituteId != null && StringUtils.hasText(instituteId))
                instituteInfoDTO = internalService.getInstituteByInstituteId(instituteId);

            // default vacademy theme
            name = name == null ? "User" : name;
            String instituteTheme = "#ED7424";
            String instituteName = "Vacademy";
            String instituteUrl = "https://dash.vacademy.io";
            if (instituteInfoDTO != null) {

                instituteTheme = instituteInfoDTO.getInstituteThemeCode() != null
                        ? instituteInfoDTO.getInstituteThemeCode()
                        : instituteTheme;
                instituteName = instituteInfoDTO.getInstituteName() != null ? instituteInfoDTO.getInstituteName()
                        : instituteName;
                instituteUrl = StringUtils.hasText(instituteInfoDTO.getWebsiteUrl())
                        ? instituteInfoDTO.getWebsiteUrl()
                        : instituteUrl;
            }

            // Prefer the institute's real contact email for the footer; fall back to the
            // sending address, normalized so a '"Display Name <email>"' from-value never
            // leaks an HTML-tag-like "<...>" into the body.
            String footerEmail = (instituteInfoDTO != null && StringUtils.hasText(instituteInfoDTO.getEmail()))
                    ? instituteInfoDTO.getEmail().trim()
                    : normalizeFromAddress(fromToUse);
            if (footerEmail == null) {
                footerEmail = "";
            }
            final String instituteEmailForBody = footerEmail;

            final String emailSubject = StringUtils.hasText(subject)
                    ? subject
                    : "Your One-Time Password (OTP) for " + instituteName + " Access | " + otp;

            // Build the HTML body for the OTP email
            final String emailBody = createEmailBody(name, otp, instituteTheme, instituteName, instituteUrl,
                    instituteEmailForBody);

            final boolean includeSesHeader = shouldIncludeSesConfigurationHeader(instituteId);

            emailDispatcher.sendEmail(() -> {
                try {
                    Session session = Session.getDefaultInstance(new Properties(), null);
                    MimeMessage message = new MimeMessage(session);

                    message.setRecipient(Message.RecipientType.TO, new InternetAddress(to));
                    message.setFrom(new InternetAddress(fromToUse));
                    message.setSubject(emailSubject);

                    // Add SES configuration set header for event tracking
                    if (includeSesHeader) {
                        message.setHeader("X-SES-CONFIGURATION-SET", sesConfigurationSet);
                    }

                    // Add HTML content
                    MimeMultipart multipart = new MimeMultipart();
                    MimeBodyPart htmlPart = new MimeBodyPart();
                    htmlPart.setContent(emailBody, "text/html; charset=utf-8");
                    multipart.addBodyPart(htmlPart);

                    message.setContent(multipart);

                    logger.info("Sending OTP email to: {}", to);
                    mailSenderToUse.send(message);
                    logger.info("OTP email successfully sent to: {}", to);

                    // Preserve existing OTP behavior: sourceId = calling service identifier (replies to OTP emails are not expected).
                    saveEmailNotificationLog(to, emailSubject, emailBody, "OTP_SERVICE", service, null, fromToUse);

                } catch (Exception e) {
                    logger.error("Error while sending OTP email", e);
                    SentryLogger.SentryEventBuilder.error(e)
                            .withMessage("Failed to send OTP email")
                            .withTag("notification.type", "EMAIL")
                            .withTag("email.type", "OTP")
                            .withTag("recipient.email", to)
                            .withTag("institute.id", instituteId != null ? instituteId : "unknown")
                            .withTag("operation", "sendEmailOtp")
                            .send();
                    throw new RuntimeException("Failed to send OTP email", e);
                }
            });

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            logger.error("OTP email sending interrupted due to rate limiting", e);
            throw new RuntimeException("Failed to send OTP email due to rate limiting", e);
        } catch (Exception e) {
            logger.error("An error occurred while preparing the OTP email", e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to prepare OTP email")
                    .withTag("notification.type", "EMAIL")
                    .withTag("email.type", "OTP")
                    .withTag("recipient.email", to)
                    .withTag("institute.id", instituteId != null ? instituteId : "unknown")
                    .withTag("operation", "prepareEmailOtp")
                    .send();
            throw new RuntimeException("An error occurred while preparing the OTP email", e);
        }
    }

    // Method to create the email body
    // Method to create the email body with placeholders {{service}}, {{name}},
    // {{otp}}
    private String createEmailBody(String name, String otp, String theme, String instituteName, String instituteWebsite,
            String instituteEmail) {
        String template = """
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Confirm Email</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            margin: 0;
                            padding: 0;
                            background-color: #FFF7E1;
                        }
                        .container {
                            max-width: 600px;
                            margin: 40px auto;
                            padding: 20px;
                            background-color: #FFFFFF;
                            border: 2px solid {{theme}};
                            border-radius: 10px;
                            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                        }
                        .content {
                            padding: 20px;
                            font-size: 16px;
                            color: black;
                            line-height: 1.6;
                        }
                        .otp {
                            font-size: 22px;
                            font-weight: bold;
                            color: white;
                            text-align: center;
                            padding: 10px;
                            background-color: {{theme}};
                            border: 2px solid {{theme}};
                            border-radius: 5px;
                            margin: 15px 0;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="content">
                            <p>Dear User,</p>
                            <p>Your One-Time Password (OTP) to access <b>{{instituteName}}</b> is:</p>

                            <div class="otp">{{otp}}</div>

                            <p>This OTP is valid for <b>10 minutes</b> and can be used only once.</p>
                            <p>Please do not share this code with anyone for security reasons.</p>

                            <p>If you did not request this code, please ignore this message or
                            contact our support team immediately.</p>

                            <p>Thank you,</p>
                            <p><b>{{instituteName}} Support Team</b></p>
                            <p>Email: {{instituteEmail}}</p>
                            <p>Web: <a href="{{instituteWebsiteHref}}" target="_blank">{{instituteWebsite}}</a></p>
                        </div>
                    </div>
                </body>
                </html>
                """;

        // Display text keeps the stored value; the href gets an https:// scheme when
        // the stored URL lacks one so the link is not treated as relative.
        String instituteWebsiteHref = instituteWebsite;
        if (StringUtils.hasText(instituteWebsiteHref)
                && !instituteWebsiteHref.matches("(?i)^[a-z][a-z0-9+.\\-]*://.*")) {
            instituteWebsiteHref = "https://" + instituteWebsiteHref;
        }

        return template
                .replace("{{name}}", name)
                .replace("{{otp}}", otp)
                .replace("{{theme}}", theme)
                .replace("{{instituteEmail}}", instituteEmail)
                .replace("{{instituteName}}", instituteName)
                .replace("{{instituteWebsiteHref}}", instituteWebsiteHref)
                .replace("{{instituteWebsite}}", instituteWebsite);
    }

    public void sendHtmlEmail(String to, String subject, String service, String body, String instituteId) {
        sendHtmlEmail(to, subject, service, body, instituteId, null, null, null);
    }

    public void sendHtmlEmail(String to, String subject, String service, String body, String instituteId,
            String customFromEmail, String customFromName) {
        sendHtmlEmail(to, subject, service, body, instituteId, customFromEmail, customFromName, null);
    }

    public void sendHtmlEmail(String to, String subject, String service, String body, String instituteId,
            String customFromEmail, String customFromName, String emailType) {
        sendHtmlEmail(to, subject, service, body, instituteId, customFromEmail, customFromName, emailType, null, null);
    }

    /**
     * Full overload with ledger attribution: {@code correlationId} lands in
     * notification_log.correlation_id (Engagement Engine action id → exact send/read joins)
     * and {@code userId} attributes the row to a platform user (the other overloads write
     * userId=null, which makes per-user ledger queries blind to those sends).
     */
    public void sendHtmlEmail(String to, String subject, String service, String body, String instituteId,
            String customFromEmail, String customFromName, String emailType,
            String correlationId, String userId) {
        sendHtmlEmail(to, subject, service, body, instituteId, customFromEmail, customFromName, emailType,
                correlationId, userId, null, null);
    }

    /** What happened to one HTML send. Narrower overloads discard this. */
    public enum SendOutcome { SENT, DEFERRED, SKIPPED_BLOCKED, SKIPPED_UNSUBSCRIBED }

    /**
     * Widest overload: adds copy recipients ({@code cc} + {@code ccMode}) on top of the ledger
     * attribution above. Copies are resolved per-institute by {@code EmailCcResolver} and passed
     * down from {@code UnifiedSendService}; all narrower overloads pass null and behave exactly
     * as before.
     *
     * Sending controls (both read from the sender's EMAIL_SETTING.data.<type> node):
     *  - a recipient who unsubscribed from this institute is skipped when the send is
     *    promotional (or the sender opted every type in via list_unsubscribe);
     *  - a sender with max_per_day reserves a slot atomically; past the cap the email is
     *    written to deferred_email and replayed when the next window opens.
     */
    public SendOutcome sendHtmlEmail(String to, String subject, String service, String body, String instituteId,
            String customFromEmail, String customFromName, String emailType,
            String correlationId, String userId, List<String> cc, String ccMode) {
        return doSendHtml(to, subject, service, body, instituteId, customFromEmail, customFromName, emailType,
                correlationId, userId, cc, ccMode, false);
    }

    /**
     * Replay of a deferred row. If the cap is still reached the outcome is DEFERRED and NO new
     * row is written — the drainer pushes the existing rows to the next window itself.
     */
    public SendOutcome sendDeferred(DeferredEmail d, List<String> cc) {
        return doSendHtml(d.getToEmail(), d.getSubject(), d.getService(), d.getBody(), d.getInstituteId(),
                d.getCustomFromEmail(), d.getCustomFromName(), d.getEmailType(), d.getCorrelationId(), d.getUserId(),
                cc, d.getCcMode(), true);
    }

    /** True when this recipient opted out and the sender/type honours opt-outs. */
    public boolean isUnsubscribed(String email, String instituteId, String emailType) {
        if (instituteId == null || email == null) return false;
        try {
            SenderPolicy policy = SenderPolicy.from(getMailSenderConfig(instituteId, emailType).node());
            return policy.unsubscribeApplies(emailType) && emailUnsubscribeService.isUnsubscribed(email, instituteId);
        } catch (Exception e) {
            return false;
        }
    }

    public LocalDateTime nextWindowFor(String instituteId, String emailType) {
        try {
            return SenderPolicy.from(getMailSenderConfig(instituteId, emailType).node()).nextWindow();
        } catch (Exception e) {
            return LocalDateTime.now().plusDays(1);
        }
    }

    public EmailSendingStatusDTO sendingStatus(String instituteId, String emailType) {
        ResolvedSender cfg = getMailSenderConfig(instituteId, emailType);
        SenderPolicy p = SenderPolicy.from(cfg.node());
        String fromEmail = normalizeFromAddress(cfg.getValue());
        String key = SenderPolicy.senderKey(instituteId, emailType, fromEmail);
        return EmailSendingStatusDTO.builder()
                .instituteId(instituteId)
                .emailType(emailType)
                .fromEmail(fromEmail)
                .maxPerDay(p.maxPerDay())
                .sentToday(emailDailyQuotaService.sentToday(key, p.today()))
                .deferredPending(deferredEmailService.pendingForSender(key))
                .timezone(p.zone().getId())
                .sendAfterHour(p.sendAfterHour())
                .nextWindow(p.capped() ? p.nextWindow().toString() : null)
                .pausedToday(p.pausedToday())
                .skipWeekends(p.skipWeekends())
                .rampEnabled(p.ramp() != null)
                .rampCeiling(p.ramp() != null ? p.ramp().ceiling() : 0)
                .rampStartedOn(p.ramp() != null && p.ramp().startedOn() != null ? p.ramp().startedOn().toString() : null)
                .rampNextIncreaseOn(p.ramp() != null && p.ramp().nextIncreaseAfter(p.today()) != null
                        ? p.ramp().nextIncreaseAfter(p.today()).toString() : null)
                .unsubscribeFooter(p.unsubscribeApplies(emailType))
                .unsubscribedCount(emailUnsubscribeService.countActive(instituteId))
                .build();
    }

    /** Call off every email still queued behind this sender's daily cap. */
    public int cancelQueued(String instituteId, String emailType, String reason) {
        ResolvedSender cfg = getMailSenderConfig(instituteId, emailType);
        String key = SenderPolicy.senderKey(instituteId, emailType, normalizeFromAddress(cfg.getValue()));
        return deferredEmailService.cancelPending(key, reason);
    }

    private SendOutcome doSendHtml(String to, String subject, String service, String body, String instituteId,
            String customFromEmail, String customFromName, String emailType,
            String correlationId, String userId, List<String> cc, String ccMode, boolean fromQueue) {
        try {
            // Check if email is blocked (domain blocklist or bounced email blocklist)
            if (isEmailBlocked(to)) {
                logger.info("Skipping HTML email for blocked email address: {}", to);
                return SendOutcome.SKIPPED_BLOCKED;
            }

            ResolvedSender config = getMailSenderConfig(instituteId, emailType);
            final JavaMailSender finalMailSender = config.getKey();
            String fromEmail = config.getValue();
            final SenderPolicy policy = SenderPolicy.from(config.node());
            final boolean unsubApplies = instituteId != null && policy.unsubscribeApplies(emailType);

            if (unsubApplies && emailUnsubscribeService.isUnsubscribed(to, instituteId)) {
                logger.info("Skipping HTML email to {}: unsubscribed from institute {}", to, instituteId);
                return SendOutcome.SKIPPED_UNSUBSCRIBED;
            }

            logger.info("Sending HTML email to: {} using emailType: {} for service: {}", to, emailType, service);

            // Determine final from address - custom email takes highest priority
            final String finalFromEmail;
            if (customFromEmail != null && !customFromEmail.trim().isEmpty()) {
                finalFromEmail = customFromEmail;
                logger.info("Using custom from email: {} for service: {}", customFromEmail, service);
            } else {
                finalFromEmail = fromEmail;
                logger.info("Using from email from config: {} for service: {}", fromEmail, service);
            }

            // Determine final from name (see resolveFromName for the bare-address fallback).
            final String finalFromName = resolveFromName(customFromEmail, customFromName, fromEmail);

            // Daily cap: reserve a slot or hand the email to the deferred queue. A weekend
            // pause is checked first — it is not "cap 0" (that means unlimited), and no slot
            // should be consumed on a day nothing may go out.
            if (policy.capped()) {
                String senderKey = SenderPolicy.senderKey(instituteId, emailType, normalizeFromAddress(finalFromEmail));
                boolean allowed = !policy.pausedToday()
                        && emailDailyQuotaService.tryReserve(senderKey, policy.today(), policy.maxPerDay());
                if (!allowed) {
                    if (!fromQueue) {
                        deferredEmailService.defer(senderKey, policy.nextWindow(), instituteId, emailType, to, subject,
                                body, service, customFromEmail, customFromName, correlationId, userId, cc, ccMode);
                    }
                    return SendOutcome.DEFERRED;
                }
            }

            String emailSubject = StringUtils.hasText(subject) ? subject : "This is a very important email";
            // Footer names the sender the way the inbox shows it: explicit display name, else the
            // name stored in the config's "Name <addr>" from-string, else the bare address.
            final String footerSender = finalFromName != null ? finalFromName
                    : (displayNameOf(fromEmail) != null ? displayNameOf(fromEmail) : normalizeFromAddress(finalFromEmail));
            final String emailBody = unsubApplies
                    ? unsubscribeMailer.withFooter(body, instituteId, to, policy, footerSender)
                    : body;

            final boolean includeSesHeader = shouldIncludeSesConfigurationHeader(instituteId);

            emailDispatcher.sendEmail(() -> {
                try {
                    MimeMessage message = new MimeMessage(Session.getInstance(new Properties()));
                    message.setRecipient(Message.RecipientType.TO, new InternetAddress(to));
                    applyCopyRecipients(message, cc, ccMode);

                    // Set from address with optional display name
                    if (finalFromName != null) {
                        message.setFrom(new InternetAddress(finalFromEmail, finalFromName));
                    } else {
                        message.setFrom(new InternetAddress(finalFromEmail));
                    }

                    message.setSubject(emailSubject);

                    // Add SES configuration set header for event tracking
                    if (includeSesHeader) {
                        message.setHeader("X-SES-CONFIGURATION-SET", sesConfigurationSet);
                    }
                    // RFC 8058 one-click unsubscribe headers for commercial mail
                    if (unsubApplies) {
                        unsubscribeMailer.addHeaders(message, instituteId, to);
                    }

                    MimeMultipart multipart = new MimeMultipart();
                    MimeBodyPart htmlPart = new MimeBodyPart();
                    htmlPart.setContent(emailBody, "text/html; charset=utf-8");
                    multipart.addBodyPart(htmlPart);

                    message.setContent(multipart);
                    finalMailSender.send(message);

                    String messageId = null;
                    try { messageId = message.getMessageID(); } catch (Exception ignored) {}
                    saveEmailNotificationLog(to, emailSubject, emailBody, service != null ? service : "HTML_EMAIL_SERVICE", messageId, userId, finalFromEmail, instituteId, correlationId);

                } catch (Exception e) {
                    logger.error("Failed to send HTML email to: {}", to, e);
                    SentryLogger.SentryEventBuilder.error(e)
                            .withMessage("Failed to send HTML email")
                            .withTag("notification.type", "EMAIL")
                            .withTag("email.type", emailType != null ? emailType : "HTML")
                            .withTag("recipient.email", to)
                            .withTag("institute.id", instituteId != null ? instituteId : "unknown")
                            .withTag("service", service != null ? service : "unknown")
                            .withTag("operation", "sendHtmlEmail")
                            .send();
                    throw new RuntimeException("Failed to send HTML email", e);
                }
            });
            return SendOutcome.SENT;

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Failed to send HTML email due to rate limiting", e);
        }
    }

    public void sendAttachmentEmail(String to, String subject, String service, String body,
            Map<String, byte[]> attachments, String instituteId) {
        sendAttachmentEmail(to, subject, service, body, attachments, instituteId, null);
    }

    public void sendAttachmentEmail(String to, String subject, String service, String body,
            Map<String, byte[]> attachments, String instituteId, String emailType) {
        sendAttachmentEmail(to, subject, service, body, attachments, instituteId, emailType, null, null);
    }

    /**
     * Attachment send with copy recipients. Copies receive the SAME attachment payload (typically
     * the invoice/receipt PDF) as the primary recipient, which is the point of an accounts BCC.
     */
    public void sendAttachmentEmail(String to, String subject, String service, String body,
            Map<String, byte[]> attachments, String instituteId, String emailType,
            List<String> cc, String ccMode) {
        try {
            // Check if email is blocked (domain blocklist or bounced email blocklist)
            if (isEmailBlocked(to)) {
                logger.info("Skipping attachment email for blocked email address: {}", to);
                return;
            }

            logger.info("Preparing to send email to: {} with subject: {}", to, subject);

            // Use emailType parameter, default to UTILITY_EMAIL if not specified
            AbstractMap.SimpleEntry<JavaMailSender, String> config = getMailSenderConfig(instituteId, emailType);
            JavaMailSender mailSenderToUse = config.getKey();
            String fromToUse = config.getValue();

            final String emailSubject = StringUtils.hasText(subject)
                    ? subject
                    : "This is a very important email";
            final String emailBody = body;

            final boolean includeSesHeader = shouldIncludeSesConfigurationHeader(instituteId);

            emailDispatcher.sendEmail(() -> {
                try {
                    logger.info("Setting up email session and message...");
                    Session session = Session.getDefaultInstance(new Properties(), null);
                    MimeMessage message = new MimeMessage(session);

                    message.setRecipient(Message.RecipientType.TO, new InternetAddress(to));
                    applyCopyRecipients(message, cc, ccMode);
                    message.setFrom(new InternetAddress(fromToUse));
                    message.setSubject(emailSubject);

                    // Add SES configuration set header for event tracking
                    if (includeSesHeader) {
                        message.setHeader("X-SES-CONFIGURATION-SET", sesConfigurationSet);
                    }

                    MimeMultipart multipart = new MimeMultipart();

                    // Add HTML body
                    MimeBodyPart htmlPart = new MimeBodyPart();
                    htmlPart.setContent(emailBody, "text/html; charset=utf-8");
                    multipart.addBodyPart(htmlPart);

                    // Add attachments
                    if (attachments != null && !attachments.isEmpty()) {
                        for (Map.Entry<String, byte[]> entry : attachments.entrySet()) {
                            byte[] data = entry.getValue();
                            if (data != null && data.length > 0) {
                                MimeBodyPart attachmentPart = new MimeBodyPart();
                                ByteArrayDataSource dataSource = new ByteArrayDataSource(data, "application/pdf");
                                attachmentPart.setDataHandler(new DataHandler(dataSource));
                                attachmentPart.setFileName(entry.getKey());
                                multipart.addBodyPart(attachmentPart);
                            }
                        }
                    }

                    message.setContent(multipart);

                    logger.info("Sending email to: {}", to);
                    mailSenderToUse.send(message);
                    logger.info("Email successfully sent to: {}", to);

                    String messageId = null;
                    try { messageId = message.getMessageID(); } catch (Exception ignored) {}
                    saveEmailNotificationLog(to, emailSubject, emailBody, service != null ? service : "ATTACHMENT_EMAIL_SERVICE", messageId, null, fromToUse);

                } catch (MessagingException e) {
                    logger.error("Error while preparing or sending the email", e);
                    SentryLogger.SentryEventBuilder.error(e)
                            .withMessage("Failed to send email with attachments")
                            .withTag("notification.type", "EMAIL")
                            .withTag("email.type", "ATTACHMENT")
                            .withTag("recipient.email", to)
                            .withTag("institute.id", instituteId != null ? instituteId : "unknown")
                            .withTag("attachment.count", String.valueOf(attachments != null ? attachments.size() : 0))
                            .withTag("operation", "sendAttachmentEmail")
                            .send();
                    throw new RuntimeException("Failed to send email with attachments", e);
                }
            });

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            logger.error("Email sending interrupted due to rate limiting", e);
            throw new RuntimeException("Failed to send email due to rate limiting", e);
        } catch (Exception e) {
            logger.error("An error occurred while preparing the email", e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to prepare attachment email")
                    .withTag("notification.type", "EMAIL")
                    .withTag("email.type", "ATTACHMENT")
                    .withTag("recipient.email", to)
                    .withTag("institute.id", instituteId != null ? instituteId : "unknown")
                    .withTag("attachment.count", String.valueOf(attachments != null ? attachments.size() : 0))
                    .withTag("operation", "prepareAttachmentEmail")
                    .send();
            throw new RuntimeException("An error occurred while preparing the email", e);
        }
    }

    /**
     * Resolve the from email address that would be used for a given institute and email type.
     * Useful for checking unsubscribe preferences before sending.
     */
    public String resolveFromEmailAddress(String instituteId, String emailType) {
        try {
            AbstractMap.SimpleEntry<JavaMailSender, String> config = getMailSenderConfig(instituteId, emailType);
            return config.getValue();
        } catch (Exception e) {
            logger.warn("Failed to resolve from address for institute {} emailType {}: {}", instituteId, emailType, e.getMessage());
            return from;
        }
    }

    /**
     * Resolve all available email senders for an institute (type + from address).
     */
    public List<EmailSenderInfo> listInstituteEmailSenders(String instituteId) {
        Set<EmailSenderInfo> senders = new LinkedHashSet<>();
        senders.add(new EmailSenderInfo(NotificationConstants.UTILITY_EMAIL, from));

        if (!StringUtils.hasText(instituteId)) {
            return new ArrayList<>(senders);
        }

        try {
            List<EmailConfigDTO> configurations = emailConfigurationService.getEmailConfigurations(instituteId);
            configurations.stream()
                    .filter(Objects::nonNull)
                    .forEach(config -> {
                        String type = config.getType();
                        String email = config.getEmail();
                        if (StringUtils.hasText(type) && StringUtils.hasText(email)) {
                            senders.add(new EmailSenderInfo(type.trim().toUpperCase(), email.trim()));
                        }
                    });
        } catch (Exception e) {
            logger.warn("Failed to resolve institute email senders for {}: {}", instituteId, e.getMessage());
        }

        return new ArrayList<>(senders);
    }

    private String resolveFromAddress(JsonNode config, String defaultFrom) {
        if (config == null || config.isMissingNode()) {
            return defaultFrom;
        }

        String fromAddress = config.path(NotificationConstants.FROM).asText(null);
        if (!StringUtils.hasText(fromAddress)) {
            fromAddress = config.path("fromEmail").asText(null);
        }
        if (!StringUtils.hasText(fromAddress)) {
            fromAddress = config.path("fromAddress").asText(null);
        }
        if (!StringUtils.hasText(fromAddress)) {
            fromAddress = config.path("from_email").asText(null);
        }
        if (!StringUtils.hasText(fromAddress)) {
            fromAddress = config.path("from_email_address").asText(null);
        }
        if (!StringUtils.hasText(fromAddress)) {
            fromAddress = config.path("email").asText(null);
        }

        if (!StringUtils.hasText(fromAddress)) {
            return defaultFrom;
        }
        return fromAddress.trim();
    }

    public static class EmailSenderInfo {
        private final String emailType;
        private final String fromAddress;

        public EmailSenderInfo(String emailType, String fromAddress) {
            this.emailType = emailType;
            this.fromAddress = fromAddress;
        }

        public String getEmailType() {
            return emailType;
        }

        public String getFromAddress() {
            return fromAddress;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o)
                return true;
            if (!(o instanceof EmailSenderInfo that))
                return false;
            return Objects.equals(emailType, that.emailType) &&
                    Objects.equals(fromAddress, that.fromAddress);
        }

        @Override
        public int hashCode() {
            return Objects.hash(emailType, fromAddress);
        }
    }
}