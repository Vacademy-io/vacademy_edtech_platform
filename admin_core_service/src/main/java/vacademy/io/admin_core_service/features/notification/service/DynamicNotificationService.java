package vacademy.io.admin_core_service.features.notification.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.notification.dto.NotificationTemplateVariables;
import vacademy.io.admin_core_service.features.notification.dto.WatiConfig;
import vacademy.io.admin_core_service.features.notification.entity.NotificationEventConfig;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationSourceType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationTemplateType;
import vacademy.io.admin_core_service.features.notification.repository.NotificationEventConfigRepository;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.SendUniqueLinkService;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.service.CouponCodeService;
import vacademy.io.admin_core_service.features.learner.service.LearnerInvitationLinkService;
import vacademy.io.admin_core_service.features.institute.service.InstituteService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.PackageEntity;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class DynamicNotificationService {

    private final NotificationEventConfigRepository configRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final SendUniqueLinkService sendUniqueLinkService;
    private final NotificationService notificationService;
    private final TemplateRepository templateRepository;
    private final LearnerInvitationLinkService learnerInvitationLinkService;
    private final InstituteService instituteService;
    private final WatiContactAttributeService watiContactAttributeService;
    private final CouponCodeService couponCodeService;
    private final vacademy.io.admin_core_service.features.shortlink.service.ShortUrlManagementService shortUrlManagementService;
    private final EnrollInviteRepository enrollInviteRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * If the institute's setting JSON contains
     *   setting.EMAIL_SETTING.data.REFERRAL_EMAIL.invite_code = "xxxxxx"
     * resolve and return that EnrollInvite for use in referral / invitation
     * link generation. Otherwise return the supplied fallback unchanged.
     */
    private EnrollInvite resolveReferralInviteOverride(String instituteId, EnrollInvite fallback) {
        try {
            Institute institute = getInstituteFromId(instituteId);
            if (institute == null) return fallback;
            String settingJson = institute.getSetting();
            if (settingJson == null || settingJson.isBlank()) return fallback;
            JsonNode codeNode = objectMapper.readTree(settingJson)
                    .path("setting")
                    .path("EMAIL_SETTING")
                    .path("data")
                    .path("REFERRAL_EMAIL")
                    .path("invite_code");
            if (codeNode.isMissingNode() || codeNode.isNull()) return fallback;
            String code = codeNode.asText();
            if (code == null || code.isBlank()) return fallback;
            return enrollInviteRepository.findByInviteCode(code).orElse(fallback);
        } catch (Exception e) {
            log.warn("Failed to resolve referral invite override for institute {}: {}",
                    instituteId, e.getMessage());
            return fallback;
        }
    }

    /**
     * Send dynamic notifications based on event and package session
     */
    public void sendDynamicNotification(
            NotificationEventType eventName,
            String packageSessionId,
            String instituteId,
            UserDTO user,
            PaymentOption paymentOption,
            EnrollInvite enrollInvite) {

        try {
            // 1. Fetch package entity from package_session_id
            PackageEntity packageEntity = getPackageFromSessionId(packageSessionId);

            // 2. Get package session details
            PackageSession packageSession = packageSessionRepository.findById(packageSessionId)
                    .orElseThrow(() -> new VacademyException("Package session not found"));

            // 3. Find notification configurations for this event
            List<NotificationEventConfig> configs = configRepository.findByEventAndSource(
                    eventName, NotificationSourceType.BATCH, packageSessionId);

            // 4. If no configurations found, return early
            if (configs.isEmpty()) {
                log.info("No notification configurations found for event: {} and package session: {}",
                        eventName, packageSessionId);
                return;
            }

            // 5. Create template variables
            NotificationTemplateVariables templateVars = NotificationTemplateVariables.fromEntities(
                    user,
                    packageEntity,
                    getInstituteFromId(instituteId), // You'll need to implement this
                    paymentOption,
                    enrollInvite,
                    packageSessionId,
                    packageSession.getLevel() != null ? packageSession.getLevel().getLevelName() : "",
                    packageSession.getSession() != null ? packageSession.getSession().getSessionName() : "");

            // Override institute name/theme with sub-org info if the invite has a subOrgId
            if (enrollInvite != null && enrollInvite.getSubOrgId() != null && !enrollInvite.getSubOrgId().isEmpty()) {
                try {
                    Institute subOrgInstitute = getInstituteFromId(enrollInvite.getSubOrgId());
                    if (subOrgInstitute != null) {
                        templateVars.setInstituteName(subOrgInstitute.getInstituteName());
                        if (subOrgInstitute.getInstituteThemeCode() != null) {
                            templateVars.setThemeColor(subOrgInstitute.getInstituteThemeCode().trim());
                        }
                    }
                } catch (Exception e) {
                    log.warn("Could not resolve sub-org institute for subOrgId={}: {}", enrollInvite.getSubOrgId(), e.getMessage());
                }
            }

            // Populate referral and invitation templates for dynamic notifications
            try {
                EnrollInvite linkInvite = resolveReferralInviteOverride(instituteId, enrollInvite);
                String invitationLink = learnerInvitationLinkService
                        .generateLearnerInvitationResponseLink(instituteId, linkInvite, user.getId());
                String shortRefLink = learnerInvitationLinkService
                        .generateShortLearnerInvitationResponseLink(instituteId, linkInvite, user.getId());
                String refCode = learnerInvitationLinkService.getRefFromUserCoupon(user.getId());

                templateVars.setReferralLink(invitationLink);
                templateVars.setLearnerInvitationResponseLink(invitationLink);
                templateVars.setShortReferralLink(shortRefLink);
                templateVars.setRefCode(refCode);
                templateVars.setInviteCode(linkInvite != null ? linkInvite.getInviteCode() : "");
                // Only set theme color from parent institute if not already set by sub-org
                if (templateVars.getThemeColor() == null || templateVars.getThemeColor().isEmpty()) {
                    templateVars.setThemeColor(getThemeColorFromInstitute(getInstituteFromId(instituteId)));
                }
                templateVars.setName(user.getFullName() != null ? user.getFullName() : user.getUsername());
            } catch (Exception e) {
                log.warn("Error populating referral variables for dynamic notification user {}: {}", user.getId(),
                        e.getMessage());
            }

            // Update WATI contact attributes BEFORE sending template messages,
            // so that WATI automation flows triggered by the template have the
            // correct {{short_referral_link}} contact attribute already set.
            updateWatiContactAttributes(getInstituteFromId(instituteId), user, templateVars.getShortReferralLink());

            // 6. Process each configuration — use unified send API (falls back to legacy on error)
            for (NotificationEventConfig config : configs) {
                sendNotificationViaUnifiedApi(config, instituteId, user, templateVars);
            }

        } catch (Exception e) {
            log.error("Error sending dynamic notification for event: {} and package session: {}",
                    eventName, packageSessionId, e);
            throw new VacademyException("Failed to send notification: " + e.getMessage());
        }
    }

    /**
     * Get package entity from package session ID
     */
    private PackageEntity getPackageFromSessionId(String packageSessionId) {
        PackageSession packageSession = packageSessionRepository.findById(packageSessionId)
                .orElseThrow(() -> new VacademyException("Package session not found with ID: " + packageSessionId));

        PackageEntity packageEntity = packageSession.getPackageEntity();
        if (packageEntity == null) {
            throw new VacademyException("Package not found for package session ID: " + packageSessionId);
        }

        return packageEntity;
    }

    /**
     * Send notification based on template type
     */
    private void sendNotificationByType(
            NotificationEventConfig config,
            String instituteId,
            UserDTO user,
            NotificationTemplateVariables templateVars,
            EnrollInvite enrollInvite) {

        try {
            switch (config.getTemplateType()) {
                case EMAIL:
                    sendUniqueLinkService.sendUniqueLinkByEmailByEnrollInvite(
                            instituteId, user, config.getTemplateId(), enrollInvite, templateVars);
                    log.info("Sent email notification using template: {} with dynamic variables",
                            config.getTemplateId());
                    break;

                case WHATSAPP:
                    sendUniqueLinkService.sendUniqueLinkByWhatsApp(
                            instituteId, user, config.getTemplateId(), templateVars);
                    log.info("Sent WhatsApp notification using template: {} with dynamic variables",
                            config.getTemplateId());
                    break;

                case SMS:
                    // Implement SMS sending if needed
                    log.info("SMS notification not implemented yet for template: {}", config.getTemplateId());
                    break;

                case PUSH:
                    // Implement push notification if needed
                    log.info("Push notification not implemented yet for template: {}", config.getTemplateId());
                    break;

                default:
                    log.warn("Unknown template type: {}", config.getTemplateType());
            }
        } catch (Exception e) {
            log.error("Error sending {} notification with template: {}",
                    config.getTemplateType(), config.getTemplateId(), e);
        }
    }

    /**
     * Unified send path — sends via notification-service's /v1/send endpoint.
     * Uses templateName when available (new path), falls back to templateId lookup (legacy).
     * Notification service resolves template content + variables from its own DB.
     */
    private void sendNotificationViaUnifiedApi(
            NotificationEventConfig config,
            String instituteId,
            UserDTO user,
            NotificationTemplateVariables templateVars) {

        try {
            // Always resolve the Template entity from admin-core's `templates`, regardless
            // of whether templateName or templateId is set on the config. notification-service's
            // notification_template table is NOT a mirror of admin-core's templates, so relying
            // on cross-service name resolution there produced empty subject/body on the wire.
            Template template = resolveTemplate(config, instituteId);
            // Prefer the config's template_name (the WATI/Meta-approved name) for dispatch —
            // the Template row's own name may be a one-off admin-core label (e.g. a typo copy
            // used only to hold session-specific dynamic_parameters) that WATI does not know.
            String templateName = (config.getTemplateName() != null && !config.getTemplateName().isBlank())
                    ? config.getTemplateName()
                    : template.getName();

            Map<String, String> variables = sendUniqueLinkService.buildVariablesMap(template, templateVars);

            // Alias: if the template leaves program_name blank (or the admin cleared it),
            // fall back to the learner's actually-enrolled package_name. Lets {{program_name}}
            // in WhatsApp/email templates always render the real package — admins don't need
            // to hardcode (and keep syncing) a program_name per template per program.
            if (!org.springframework.util.StringUtils.hasText(variables.get("program_name"))) {
                String pkgName = variables.getOrDefault("package_name",
                                   variables.getOrDefault("packageName", ""));
                if (org.springframework.util.StringUtils.hasText(pkgName)) {
                    variables.put("program_name", pkgName);
                    variables.put("programName", pkgName);
                }
            }

            // Alias: credential sends supply the password only as user_password/userPassword, but
            // admins write {{password}} (and {{username}}) by hand — the template editor offers
            // {{email}}, which notification-service aliases, yet nothing aliased the password, so
            // it was scrubbed to blank. A send carrying a password is a credentials send, where
            // userName is always the login handle, so {{username}} is safe to alias alongside it.
            String password = variables.get("user_password");
            if (org.springframework.util.StringUtils.hasText(password)) {
                variables.putIfAbsent("password", password);
                String loginName = variables.get("user_name");
                if (org.springframework.util.StringUtils.hasText(loginName)) {
                    variables.putIfAbsent("username", loginName);
                }
            }

            String channel;
            UnifiedSendRequest.SendOptions.SendOptionsBuilder optsBuilder = UnifiedSendRequest.SendOptions.builder()
                    .source("event:" + config.getEventName())
                    .sourceId(config.getSourceId());

            UnifiedSendRequest.Recipient.RecipientBuilder recipientBuilder = UnifiedSendRequest.Recipient.builder()
                    .userId(user.getId())
                    .name(user.getFullName())
                    .variables(variables);

            switch (config.getTemplateType()) {
                case WHATSAPP:
                    channel = "WHATSAPP";
                    String phone = user.getMobileNumber();
                    if (phone != null) phone = phone.replaceAll("[^0-9]", "");
                    recipientBuilder.phone(phone);
                    // WhatsApp bodies are plain-text: convert any inline HTML
                    // (e.g. <br>, <p>, &amp;) in values into newlines / plain
                    // characters before they reach WATI — otherwise tags leak
                    // through as literal text in the delivered message.
                    Map<String, String> whatsappVariables = sanitizeVariablesForWhatsApp(variables);
                    recipientBuilder.variables(whatsappVariables);
                    // Mirror the sanitized, merged variables into WATI contact
                    // attributes so the template resolves placeholders whether
                    // WATI pulls them from customParams or contact attributes.
                    pushVariablesToWatiContactAttributes(instituteId, user, whatsappVariables);
                    break;

                case EMAIL:
                    channel = "EMAIL";
                    recipientBuilder.email(user.getEmail());
                    optsBuilder
                            .emailSubject(template.getSubject())
                            .emailBody(template.getContent())
                            .emailType("UTILITY_EMAIL");
                    break;

                case PUSH:
                    channel = "PUSH";
                    recipientBuilder.userId(user.getId());
                    String pushTitle = template.getSubject() != null && !template.getSubject().isBlank()
                            ? template.getSubject() : "Notification";
                    String pushBody = template.getContent() != null ? template.getContent() : "";
                    optsBuilder.pushTitle(pushTitle).pushBody(pushBody);
                    break;

                default:
                    log.warn("Unsupported template type for unified send: {}", config.getTemplateType());
                    return;
            }

            UnifiedSendRequest request = UnifiedSendRequest.builder()
                    .instituteId(instituteId)
                    .channel(channel)
                    .templateName(templateName)
                    .languageCode("en")
                    .recipients(java.util.List.of(recipientBuilder.build()))
                    .options(optsBuilder.build())
                    .build();

            UnifiedSendResponse response = notificationService.sendUnified(request);
            log.info("Unified send result for {} template {}: accepted={}, failed={}",
                    config.getTemplateType(), templateName,
                    response.getAccepted(), response.getFailed());

        } catch (Exception e) {
            log.error("Error sending via unified API for template {}: {}",
                    config.getTemplateId(), e.getMessage(), e);
            // Fallback to old path
            log.info("Falling back to legacy send path for template {}", config.getTemplateId());
            sendNotificationByType(config, instituteId, user, templateVars, null);
        }
    }

    /**
     * Get institute from ID using the actual InstituteService
     */
    private Institute getInstituteFromId(String instituteId) {
        try {
            return instituteService.findById(instituteId);
        } catch (Exception e) {
            log.error("Error fetching institute with ID: {}", instituteId, e);
            // Return a fallback institute with default values
            Institute fallbackInstitute = new Institute();
            fallbackInstitute.setId(instituteId);
            fallbackInstitute.setInstituteName("Unknown Institute");
            return fallbackInstitute;
        }
    }

    /**
     * Normalised learner-portal base URL for login links (the Parent Portal is
     * served under it). Prod values are inconsistent — bare host vs http(s)://
     * prefix vs trailing slash — so coerce to a clean {@code https://host}
     * form, mirroring StudentReportNotificationService. Returns null if the
     * institute has no learner portal configured.
     */
    private String resolveLearnerPortalUrl(Institute institute) {
        if (institute == null || !org.springframework.util.StringUtils.hasText(institute.getLearnerPortalBaseUrl())) {
            return null;
        }
        String base = institute.getLearnerPortalBaseUrl().trim();
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            base = "https://" + base;
        }
        if (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    private String getThemeColorFromInstitute(Institute institute) {
        if (institute == null || institute.getInstituteThemeCode() == null ||
                institute.getInstituteThemeCode().trim().isEmpty()) {
            return "#FF9800"; // Default orange color
        }

        String themeCode = institute.getInstituteThemeCode().trim();

        // If theme code is already a hex color, return it
        if (themeCode.startsWith("#") && themeCode.length() == 7) {
            return themeCode;
        }

        // If theme code is a hex color without #, add it
        if (themeCode.matches("^[0-9A-Fa-f]{6}$")) {
            return "#" + themeCode;
        }

        return "#FF9800"; // Default orange color
    }

    public void sendReferralInvitationNotification(
            String instituteId,
            UserDTO user,
            EnrollInvite enrollInvite) {

        try {
            // Find notification configurations for REFERRAL_INVITATION event
            List<NotificationEventConfig> configs = configRepository.findByEventAndSource(
                    NotificationEventType.REFERRAL_INVITATION,
                    NotificationSourceType.INSTITUTE,
                    instituteId);

            // If no institute-specific config found then return
            if (configs.isEmpty()) {
                log.info("No referral invitation notification configurations found for institute: {}", instituteId);
                return;
            }

            // Get institute details
            Institute institute = getInstituteFromId(instituteId);

            EnrollInvite linkInvite = resolveReferralInviteOverride(instituteId, enrollInvite);

            // Generate learner invitation response links (long link)
            String invitationLink = learnerInvitationLinkService
                    .generateLearnerInvitationResponseLink(instituteId, linkInvite, user.getId());

            // Generate short invitation link
            String shortRefLink = learnerInvitationLinkService
                    .generateShortLearnerInvitationResponseLink(instituteId, linkInvite, user.getId());

            // Get the coupon code's short_url to use as referral link if available
            String couponShortUrl = shortRefLink;
            try {
                java.util.Optional<vacademy.io.admin_core_service.features.user_subscription.entity.CouponCode> couponCode = couponCodeService
                        .getCouponCodeBySource(user.getId(), "USER");
                if (couponCode.isPresent() && couponCode.get().getShortUrl() != null
                        && !couponCode.get().getShortUrl().trim().isEmpty()) {
                    couponShortUrl = shortUrlManagementService.getAbsoluteShortUrl(
                            instituteId, couponCode.get().getShortUrl());
                }
            } catch (Exception e) {
                log.warn("Error getting short URL from coupon for user {}: {}", user.getId(), e.getMessage());
            }

            // Get theme color from institute (default to orange if not set)
            String themeColor = getThemeColorFromInstitute(institute);

            // Create template variables for referral invitation
            NotificationTemplateVariables templateVars = NotificationTemplateVariables.builder()
                    // User details
                    .userId(user.getId())
                    .userName(user.getUsername())
                    .userEmail(user.getEmail())
                    .userMobile(user.getMobileNumber())
                    .userFullName(user.getFullName())
                    .refCode(learnerInvitationLinkService.getRefFromUserCoupon(user.getId()))

                    // Institute details
                    .instituteName(institute.getInstituteName())
                    .instituteId(institute.getId())

                    // Enroll invite details
                    .enrollInviteCode(linkInvite != null ? linkInvite.getInviteCode() : "")
                    .enrollInviteExpiryDate(linkInvite != null && linkInvite.getEndDate() != null
                            ? linkInvite.getEndDate().toString()
                            : "")

                    // Learner invitation response link
                    .learnerInvitationResponseLink(invitationLink)

                    // Referral template variables
                    .name(user.getFullName() != null ? user.getFullName() : user.getUsername())
                    .referralLink(invitationLink)
                    .shortReferralLink(couponShortUrl) // Use the coupon short URL
                    .inviteCode(linkInvite != null ? linkInvite.getInviteCode() : "")
                    .themeColor(themeColor)
                    .build();

            // Update WATI contact attributes if configured
            updateWatiContactAttributes(institute, user, couponShortUrl);

            // Process each configuration via unified send
            for (NotificationEventConfig config : configs) {
                sendNotificationViaUnifiedApi(config, instituteId, user, templateVars);
            }

        } catch (Exception e) {
            log.error("Error sending referral invitation notification for institute: {}",
                    instituteId, e);
            throw new VacademyException("Failed to send referral invitation notification: " + e.getMessage());
        }
    }

    /**
     * Convert HTML-bearing values in the variables map into WATI-safe plain text.
     * Only the values are transformed; keys are preserved. Values without any
     * HTML or whitespace markup of interest are left untouched (fast path).
     *
     * WATI's bulk template API rejects any template-parameter value that contains
     * new-line / tab characters or more than 4 consecutive spaces
     * (error: "Sample Content param text cannot have new-line/tab characters…"),
     * so we strip those before the values leave admin-core.
     *
     * Transformations applied per value:
     *   &lt;br&gt; / &lt;br/&gt; / &lt;br /&gt;  → single space
     *   &lt;p&gt;…&lt;/p&gt;                     → content + single space
     *   any other tag                            → stripped (content kept)
     *   common HTML entities                     → decoded
     *   \r \n \t                                 → single space
     *   runs of whitespace (2+ chars)            → single space
     */
    private Map<String, String> sanitizeVariablesForWhatsApp(Map<String, String> variables) {
        if (variables == null || variables.isEmpty()) return variables;
        Map<String, String> sanitized = new HashMap<>(variables.size());
        for (Map.Entry<String, String> entry : variables.entrySet()) {
            sanitized.put(entry.getKey(), htmlToWhatsAppText(entry.getValue()));
        }
        return sanitized;
    }

    private static String htmlToWhatsAppText(String value) {
        if (value == null || value.isEmpty()) return value;
        // Fast path: no markup, no control whitespace
        if (value.indexOf('<') < 0 && value.indexOf('&') < 0
                && value.indexOf('\n') < 0 && value.indexOf('\r') < 0
                && value.indexOf('\t') < 0) {
            return value;
        }
        String out = value;
        out = out.replaceAll("(?i)<br\\s*/?>", " ");
        out = out.replaceAll("(?i)</p\\s*>", " ");
        out = out.replaceAll("(?i)<p[^>]*>", "");
        out = out.replaceAll("<[^>]+>", "");
        out = out.replace("&nbsp;", " ")
                 .replace("&amp;", "&")
                 .replace("&lt;", "<")
                 .replace("&gt;", ">")
                 .replace("&quot;", "\"")
                 .replace("&#39;", "'")
                 .replace("&#x27;", "'");
        // WATI rejects \n / \t and runs of >4 spaces inside customParams
        out = out.replace('\r', ' ').replace('\n', ' ').replace('\t', ' ');
        out = out.replaceAll("\\s{2,}", " ");
        return out.trim();
    }

    /**
     * Push the merged template-variables map (user vars overlaid with the
     * template's admin-configured dynamic_parameters) into WATI as contact
     * attributes, so the template send has every placeholder resolvable.
     * Silently no-ops if the institute has no WATI config or phone is missing.
     */
    private void pushVariablesToWatiContactAttributes(String instituteId, UserDTO user,
            Map<String, String> variables) {
        if (user == null || user.getMobileNumber() == null || user.getMobileNumber().isBlank()) {
            return;
        }
        if (variables == null || variables.isEmpty()) {
            return;
        }
        try {
            Institute institute = getInstituteFromId(instituteId);
            WatiConfig watiConfig = watiContactAttributeService.extractWatiConfig(institute);
            if (watiConfig == null) {
                return;
            }
            Map<String, Object> attributes = new HashMap<>(variables);
            watiContactAttributeService.updateContactAttributes(
                    watiConfig, user.getMobileNumber(), attributes);
        } catch (Exception e) {
            // Never fail the send because of contact-attribute errors.
            log.warn("Failed to push merged variables to WATI contact attributes for user {}: {}",
                    user.getId(), e.getMessage());
        }
    }

    /**
     * Update WATI contact attributes with user referral code
     */
    private void updateWatiContactAttributes(Institute institute, UserDTO user, String shortReferralLink) {
        try {
            // Extract WATI configuration from institute settings
            WatiConfig watiConfig = watiContactAttributeService.extractWatiConfig(institute);

            if (watiConfig == null) {
                log.debug("No WATI configuration found for institute: {}, skipping contact attribute update",
                        institute.getId());
                return;
            }

            // Always fetch short_url directly from CouponCode table — this is the source of
            // truth.
            // The passed-in shortReferralLink is used only as a last-resort fallback.
            String couponShortUrl = null;
            try {
                java.util.Optional<vacademy.io.admin_core_service.features.user_subscription.entity.CouponCode> couponCode = couponCodeService
                        .getCouponCodeBySource(user.getId(), "USER");
                if (couponCode.isPresent() && couponCode.get().getShortUrl() != null
                        && !couponCode.get().getShortUrl().trim().isEmpty()) {
                    couponShortUrl = shortUrlManagementService.getAbsoluteShortUrl(
                            institute.getId(), couponCode.get().getShortUrl());
                    log.debug("Using absolute short_url from CouponCode table for user {}: {}", user.getId(), couponShortUrl);
                }
            } catch (Exception e) {
                log.warn("Error fetching short_url from CouponCode for user {}: {}", user.getId(), e.getMessage());
            }

            // Fallback to the passed-in value if CouponCode had no short_url
            if (couponShortUrl == null || couponShortUrl.isEmpty()) {
                couponShortUrl = shortReferralLink;
                log.debug("CouponCode had no short_url for user {}, falling back to passed shortReferralLink: {}",
                        user.getId(), couponShortUrl);
            }

            if (couponShortUrl == null || couponShortUrl.isEmpty()) {
                log.warn("No short_referral_link available for user: {}, skipping WATI contact attribute update",
                        user.getId());
                return;
            }

            // Get the plain ref code (just for extra context attributes)
            String referralCode = learnerInvitationLinkService.getRefFromUserCoupon(user.getId());

            // Build template variables map
            java.util.Map<String, Object> templateVarsMap = new java.util.HashMap<>();
            templateVarsMap.put("refCode", referralCode);
            templateVarsMap.put("shortUrl", couponShortUrl);
            templateVarsMap.put("short_referral_link", couponShortUrl); // ← the key WATI uses
            templateVarsMap.put("shortReferralLink", couponShortUrl);
            templateVarsMap.put("userName", user.getUsername());
            templateVarsMap.put("userEmail", user.getEmail());
            templateVarsMap.put("userMobile", user.getMobileNumber());
            templateVarsMap.put("userFullName", user.getFullName());
            templateVarsMap.put("userId", user.getId());
            templateVarsMap.put("instituteName", institute.getInstituteName());
            templateVarsMap.put("instituteId", institute.getId());

            log.info("Updating WATI contact attributes for user: {}, short_referral_link={}",
                    user.getId(), couponShortUrl);

            // Update contact attributes in WATI
            watiContactAttributeService.updateContactAttributes(
                    watiConfig,
                    user.getMobileNumber(),
                    templateVarsMap);

        } catch (Exception e) {
            // Log error but don't fail the entire notification process
            log.error("Error updating WATI contact attributes for user: {} in institute: {}",
                    user.getId(), institute.getId(), e);
        }
    }

    /**
     * Create notification configuration programmatically
     */
    public void createNotificationConfig(
            NotificationEventType eventName,
            NotificationSourceType sourceType,
            String sourceId,
            NotificationTemplateType templateType,
            String templateId) {

        try {
            NotificationEventConfig config = new NotificationEventConfig(
                    eventName, sourceType, sourceId, templateType, templateId);

            configRepository.save(config);
            log.info("Created notification config for event: {} with template: {}",
                    eventName, templateId);
        } catch (Exception e) {
            log.error("Error creating notification config", e);
            throw new VacademyException("Failed to create notification config: " + e.getMessage());
        }
    }

    public void sendApplicationPaymentNotification(
            String instituteId,
            UserDTO user,
            String paymentLink,
            String childName,
            String applicationId,
            String className,
            String paymentAmount) {

        try {
            // Find notification configurations for APPLICATION_PAYMENT_PENDING event
            List<NotificationEventConfig> configs = configRepository.findByEventAndSource(
                    NotificationEventType.APPLICATION_PAYMENT_PENDING,
                    NotificationSourceType.INSTITUTE,
                    instituteId);

            if (configs.isEmpty()) {
                log.info("No payment notification configurations found for institute: {}", instituteId);
                return;
            }

            Institute institute = getInstituteFromId(instituteId);

            NotificationTemplateVariables templateVars = NotificationTemplateVariables.builder()
                    .userName(user.getFullName())
                    .userEmail(user.getEmail())
                    .userMobile(user.getMobileNumber())
                    .userFullName(user.getFullName())
                    .paymentLink(paymentLink)
                    .paymentAmount(paymentAmount)
                    .instituteName(institute.getInstituteName())
                    .instituteId(institute.getId())
                    .packageSessionId(applicationId) // Using applicationId as packageSessionId for context if needed
                    .sessionName(className)
                    // Set new family details
                    .parentName(user.getFullName())
                    .childName(childName)
                    .applicantId(applicationId)
                    .build();

            // Populate custom fields as backup and for additional flexibility
            templateVars.setCustomFields(new java.util.HashMap<>());
            templateVars.getCustomFields().put("child_name", childName);
            templateVars.getCustomFields().put("applicant_id", applicationId); // Ensure custom field match
            templateVars.getCustomFields().put("application_id", applicationId);
            templateVars.getCustomFields().put("payment_link", paymentLink);
            templateVars.getCustomFields().put("class_name", className);
            templateVars.getCustomFields().put("payment_amount", paymentAmount);
            templateVars.getCustomFields().put("parent_name", user.getFullName());

            for (NotificationEventConfig config : configs) {
                sendNotificationViaUnifiedApi(config, instituteId, user, templateVars);
            }

        } catch (Exception e) {
            log.error("Error sending payment notification for applicant: {}", applicationId, e);
        }
    }

    /**
     * Guardian account created (link, link-new-guardian, or backfill) —
     * notifies whichever party the Guardian Setting is configured to notify
     * ("STUDENT" or "GUARDIAN") with the newly-created guardian's login
     * credentials. Resolves the EMAIL template via the same
     * institute-specific-config -> DEFAULT-config fallback used elsewhere
     * (see {@link vacademy.io.admin_core_service.features.live_session.service.LiveClassTemplateService});
     * a seed migration guarantees a DEFAULT config/template always exists, so
     * this is a silent no-op only if that seed was somehow removed.
     */
    public void sendGuardianAccountCreatedNotification(
            String instituteId,
            String guardianFullName,
            String guardianUsername,
            String guardianEmail,
            String guardianPassword,
            String studentFullName,
            String studentEmail,
            String recipient) {

        try {
            NotificationEventConfig config = configRepository
                    .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                            NotificationEventType.GUARDIAN_ACCOUNT_CREATED,
                            NotificationSourceType.INSTITUTE,
                            instituteId,
                            NotificationTemplateType.EMAIL)
                    .or(() -> configRepository
                            .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                                    NotificationEventType.GUARDIAN_ACCOUNT_CREATED,
                                    NotificationSourceType.INSTITUTE,
                                    "DEFAULT",
                                    NotificationTemplateType.EMAIL))
                    .orElse(null);

            if (config == null) {
                log.warn("No GUARDIAN_ACCOUNT_CREATED email config (institute or DEFAULT) found; skipping credential notification");
                return;
            }

            boolean toGuardian = "GUARDIAN".equalsIgnoreCase(recipient);
            String recipientEmail = toGuardian ? guardianEmail : studentEmail;
            String recipientName = toGuardian ? guardianFullName : studentFullName;
            if (!org.springframework.util.StringUtils.hasText(recipientEmail)) {
                log.info("Guardian credential notification skipped: recipient ({}) has no email", recipient);
                return;
            }

            Institute institute = getInstituteFromId(instituteId);
            UserDTO recipientUser = new UserDTO();
            recipientUser.setFullName(recipientName);
            recipientUser.setEmail(recipientEmail);

            NotificationTemplateVariables templateVars = NotificationTemplateVariables.builder()
                    .userName(guardianUsername)
                    .userEmail(recipientEmail)
                    .userFullName(recipientName)
                    .userPassword(guardianPassword)
                    // Guardians onboard to the Parent Portal, which is served under the
                    // LEARNER portal base URL (a PARENT-only login auto-routes to
                    // /parent/child) — NOT the admin portal.
                    .portalUrl(resolveLearnerPortalUrl(institute))
                    .instituteName(institute != null ? institute.getInstituteName() : null)
                    .instituteId(instituteId)
                    .themeColor(getThemeColorFromInstitute(institute))
                    .guardianName(guardianFullName)
                    .guardianUsername(guardianUsername)
                    .guardianEmail(guardianEmail)
                    .guardianPassword(guardianPassword)
                    .studentName(studentFullName)
                    .studentEmail(studentEmail)
                    .build();

            sendNotificationViaUnifiedApi(config, instituteId, recipientUser, templateVars);
        } catch (Exception e) {
            log.error("Error sending guardian account created notification for institute {}: {}",
                    instituteId, e.getMessage(), e);
        }
    }

    /**
     * Institute-scoped config for an event/channel, falling back to the platform-wide
     * {@code DEFAULT} row — the same two-step lookup every event-driven notification here uses.
     *
     * <p>Exposed so senders that own their own delivery mechanics (the payment-confirmation
     * mail attaches an invoice PDF and copies billing/admin recipients, which
     * {@link #sendNotificationViaUnifiedApi} does not model) can still resolve their template
     * through the standard config binding instead of hardcoding a template name.
     */
    public Optional<NotificationEventConfig> findEventConfig(
            NotificationEventType eventType, String instituteId, NotificationTemplateType templateType) {
        return configRepository
                .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                        eventType, NotificationSourceType.INSTITUTE, instituteId, templateType)
                .or(() -> configRepository
                        .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                                eventType, NotificationSourceType.INSTITUTE, "DEFAULT", templateType));
    }

    /**
     * Hands a learner their portal credentials on the channel the caller asks
     * for, using whatever template this institute has bound to
     * {@link NotificationEventType#LEARNER_CREDENTIALS_SHARED}.
     *
     * <p>Nothing about the message is hardcoded here — subject, body and
     * WhatsApp template name all come from the institute's own
     * {@code templates} row. An institute that has bound no template for the
     * requested channel sends nothing and says so, rather than falling back to
     * a generic platform-branded mail the institute never approved. That is the
     * whole point of routing this through the event config: a second institute
     * can bind a completely different template to the same event without a code
     * change, and a third can enable WhatsApp while leaving email alone.
     *
     * <p>Resolution order matches the guardian flow: the institute's own
     * binding first, then a platform-wide {@code DEFAULT} binding if one exists.
     *
     * @return true when a message was dispatched
     */
    public boolean sendLearnerCredentialsNotification(
            String instituteId,
            NotificationTemplateType channel,
            UserDTO learner,
            String username,
            String password) {
        return sendLearnerCredentialsNotification(instituteId, channel, learner, username, password, null);
    }

    /**
     * As above, but lets the caller nominate the template for this one send instead of using the
     * institute's standing binding — the admin picking a template in the share dialog, or an API
     * caller that knows exactly which template it wants. The standing binding is left untouched.
     */
    public boolean sendLearnerCredentialsNotification(
            String instituteId,
            NotificationTemplateType channel,
            UserDTO learner,
            String username,
            String password,
            String templateIdOverride) {

        try {
            NotificationEventConfig config = resolveConfigForSend(
                    NotificationEventType.LEARNER_CREDENTIALS_SHARED, instituteId, channel, templateIdOverride);

            if (config == null) {
                log.info("No LEARNER_CREDENTIALS_SHARED {} template bound for institute {}; nothing sent",
                        channel, instituteId);
                return false;
            }

            // Each channel needs a different contact detail, and an absent one is
            // a normal state (plenty of learners have no phone on file) — report
            // it back so the UI can say which channel could not be used.
            if (channel == NotificationTemplateType.EMAIL
                    && !org.springframework.util.StringUtils.hasText(learner.getEmail())) {
                log.info("Learner credential email skipped: userId={} has no email", learner.getId());
                return false;
            }
            if (channel == NotificationTemplateType.WHATSAPP
                    && !org.springframework.util.StringUtils.hasText(learner.getMobileNumber())) {
                log.info("Learner credential WhatsApp skipped: userId={} has no mobile number", learner.getId());
                return false;
            }

            Institute institute = getInstituteFromId(instituteId);

            NotificationTemplateVariables templateVars = NotificationTemplateVariables.builder()
                    .userId(learner.getId())
                    .userName(username)
                    .userEmail(learner.getEmail())
                    .userMobile(learner.getMobileNumber())
                    .userFullName(learner.getFullName())
                    .name(learner.getFullName())
                    .userPassword(password)
                    // Credentials are for the LEARNER portal, never the admin one.
                    .portalUrl(resolveLearnerPortalUrl(institute))
                    .instituteName(institute != null ? institute.getInstituteName() : null)
                    .instituteId(instituteId)
                    .themeColor(getThemeColorFromInstitute(institute))
                    .build();

            sendNotificationViaUnifiedApi(config, instituteId, learner, templateVars);
            return true;
        } catch (Exception e) {
            log.error("Error sending learner credentials ({}) for institute {}: {}",
                    channel, instituteId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * The config a single send should use: an explicitly-chosen template when the caller passes
     * one, otherwise the institute's standing binding for the event/channel.
     *
     * <p>The override is returned as an unsaved {@link NotificationEventConfig} rather than being
     * written to the table. Picking a template for one message must not silently repoint every
     * future send of that event — changing the standing binding is its own deliberate action in
     * the settings UI, and an API caller passing a one-off template is not making it.
     */
    private NotificationEventConfig resolveConfigForSend(
            NotificationEventType eventType,
            String instituteId,
            NotificationTemplateType channel,
            String templateIdOverride) {

        if (org.springframework.util.StringUtils.hasText(templateIdOverride)) {
            NotificationEventConfig transientConfig = new NotificationEventConfig(
                    eventType, NotificationSourceType.INSTITUTE, instituteId, channel, templateIdOverride);
            // WhatsApp dispatches by provider-approved template NAME; email resolves subject and
            // body off the Template row and needs no name here.
            if (channel == NotificationTemplateType.WHATSAPP) {
                templateRepository.findById(templateIdOverride)
                        .ifPresent(t -> transientConfig.setTemplateName(t.getName()));
            }
            return transientConfig;
        }
        return findEventConfig(eventType, instituteId, channel).orElse(null);
    }

    /**
     * Sends a learner a link to set a new password, rendered from whichever template the
     * institute has bound to {@link NotificationEventType#LEARNER_PASSWORD_RESET} (or from the
     * template the caller nominated for this one send).
     *
     * <p>No password is included, by design — the point of this event is to give an institute a
     * way to get a learner back into their account without mailing plaintext credentials. The
     * template gets {@code {{reset_password_link}}} and the username; everything else is the
     * usual institute branding set.
     *
     * @return true when a message was dispatched
     */
    public boolean sendLearnerPasswordResetNotification(
            String instituteId,
            NotificationTemplateType channel,
            UserDTO learner,
            String username,
            String resetLink,
            String resetLinkTemplate,
            String templateIdOverride) {

        try {
            NotificationEventConfig config = resolveConfigForSend(
                    NotificationEventType.LEARNER_PASSWORD_RESET, instituteId, channel, templateIdOverride);

            if (config == null) {
                log.info("No LEARNER_PASSWORD_RESET {} template bound for institute {}; nothing sent",
                        channel, instituteId);
                return false;
            }

            if (channel == NotificationTemplateType.EMAIL
                    && !org.springframework.util.StringUtils.hasText(learner.getEmail())) {
                log.info("Learner password-reset email skipped: userId={} has no email", learner.getId());
                return false;
            }
            if (channel == NotificationTemplateType.WHATSAPP
                    && !org.springframework.util.StringUtils.hasText(learner.getMobileNumber())) {
                log.info("Learner password-reset WhatsApp skipped: userId={} has no mobile number", learner.getId());
                return false;
            }

            Institute institute = getInstituteFromId(instituteId);

            NotificationTemplateVariables templateVars = NotificationTemplateVariables.builder()
                    .userId(learner.getId())
                    .userName(username)
                    .userEmail(learner.getEmail())
                    .userMobile(learner.getMobileNumber())
                    .userFullName(learner.getFullName())
                    .name(learner.getFullName())
                    .resetPasswordLink(resetLink)
                    .resetPasswordLinkTemplate(resetLinkTemplate)
                    .portalUrl(resolveLearnerPortalUrl(institute))
                    .instituteName(institute != null ? institute.getInstituteName() : null)
                    .instituteId(instituteId)
                    .themeColor(getThemeColorFromInstitute(institute))
                    .build();

            sendNotificationViaUnifiedApi(config, instituteId, learner, templateVars);
            return true;
        } catch (Exception e) {
            log.error("Error sending learner password reset ({}) for institute {}: {}",
                    channel, instituteId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * Resolves the Template entity referenced by a NotificationEventConfig.
     * Tries id-based lookup first so two configs sharing the same template_name can still
     * point at distinct rows (e.g. for session-specific dynamic_parameters while dispatching
     * to one shared WATI-approved template name). Falls back to name-based lookup when no
     * templateId is set on the config or when the id no longer resolves to a row.
     */
    public Template resolveTemplate(NotificationEventConfig config, String instituteId) {
        if (config.getTemplateId() != null && !config.getTemplateId().isBlank()) {
            Optional<Template> byId = templateRepository.findById(config.getTemplateId());
            if (byId.isPresent()) return byId.get();
        }

        String templateName = config.getTemplateName();
        String templateTypeStr = config.getTemplateType() != null ? config.getTemplateType().name() : null;
        if (templateName != null && !templateName.isBlank() && templateTypeStr != null) {
            Optional<Template> byName = templateRepository
                    .findByInstituteIdAndNameAndType(instituteId, templateName, templateTypeStr)
                    .or(() -> templateRepository
                            .findByInstituteIdAndNameAndType(instituteId, templateName, templateTypeStr.toLowerCase()));
            if (byName.isPresent()) return byName.get();
        }

        throw new VacademyException(
                "Template not found: config=" + config.getId() + ", name=" + templateName
                        + ", id=" + config.getTemplateId());
    }
}
