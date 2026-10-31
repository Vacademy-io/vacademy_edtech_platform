package vacademy.io.admin_core_service.features.enrollment_policy.notification;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enrollment_policy.dto.EmailNotificationContentDTO;
import vacademy.io.admin_core_service.features.enrollment_policy.dto.NotificationConfigDTO;
import vacademy.io.admin_core_service.features.enrollment_policy.dto.NotificationPolicyDTO;
import vacademy.io.admin_core_service.features.enrollment_policy.enums.NotificationType;
import vacademy.io.admin_core_service.features.enrollment_policy.processor.EnrolmentContext;
import vacademy.io.admin_core_service.features.enrollment_policy.service.EnrollmentTemplateService;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.learner.service.LearnerPortalAccessService;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

@Slf4j
@Service
@RequiredArgsConstructor
public class EmailNotificationService implements INotificationService {

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private vacademy.io.admin_core_service.features.notification_service.service.BillingContactRecipientResolver billingContactRecipientResolver;

    @Autowired
    private InstituteRepository instituteRepository;

    @Lazy
    @Autowired
    private LearnerPortalAccessService learnerPortalAccessService;

    private final EnrollmentTemplateService enrollmentTemplateService;

    @Override
    public void sendNotification(EnrolmentContext context, NotificationPolicyDTO policy) {
        // Get instituteId from first mapping (all belong to same UserPlan/Institute)
        String instituteId = context.getMappings() != null && !context.getMappings().isEmpty()
            ? context.getMappings().get(0).getInstitute().getId()
            : null;
            
        if (instituteId == null) {
            log.warn("No institute ID found in context, skipping EMAIL notification");
            return;
        }

        if (policy.getNotifications() == null || policy.getNotifications().isEmpty()) {
            log.warn("No channel notifications configured in policy for trigger: {}", policy.getTrigger());
            return;
        }

        // Process each channel notification
        for (vacademy.io.admin_core_service.features.enrollment_policy.dto.ChannelNotificationDTO channelNotification : policy
                .getNotifications()) {
            String channel = channelNotification.getChannel();

            // Only process EMAIL channel in EmailNotificationService
            if (!NotificationType.EMAIL.name().equalsIgnoreCase(channel)) {
                log.debug("Skipping non-EMAIL channel: {} in EmailNotificationService", channel);
                continue;
            }

            sendEmailForChannel(context, instituteId, channelNotification);
        }
    }

    private void sendEmailForChannel(EnrolmentContext context, String instituteId,
            vacademy.io.admin_core_service.features.enrollment_policy.dto.ChannelNotificationDTO channelNotification) {
        String templateName = channelNotification.getTemplateName();
        String subject;
        String body;
        Map<String, String> placeholders = buildPlaceholders(context, instituteId);

        if (StringUtils.hasText(templateName)) {
            // Use template from Templates table
            Template template = enrollmentTemplateService.findByNameAndInstituteId(templateName, instituteId,
                    NotificationType.EMAIL.name());
            if (template != null) {
                subject = template.getSubject();
                body = template.getContent();

                // Replace placeholders in template content
                subject = replacePlaceholders(subject, placeholders);
                body = replacePlaceholders(body, placeholders);

                log.debug("Using template: {} for EMAIL channel notification", templateName);
            } else {
                throw new VacademyException(
                        "Template not found by name: " + templateName + " for institute: " + instituteId);
            }
        } else {
            // Fallback to content from JSON config
            NotificationConfigDTO config = channelNotification.getNotificationConfig();
            if (config instanceof EmailNotificationContentDTO emailConfig
                    && emailConfig.getContent() != null) {
                subject = emailConfig.getContent().getSubject();
                body = emailConfig.getContent().getBody();

                // Replace placeholders in JSON content
                subject = replacePlaceholders(subject, placeholders);
                body = replacePlaceholders(body, placeholders);
            } else {
                log.warn("No template name and no content in config, using default template");
                subject = enrollmentTemplateService.getEmailSubject(instituteId, null, context);
                body = enrollmentTemplateService.getEmailBody(instituteId, null, context);
            }
        }

        UserDTO userDTO = context.getUser();
        String recipientEmail = userDTO != null ? userDTO.getEmail() : null;

        if (!StringUtils.hasText(recipientEmail)) {
            log.warn("No recipient email found, skipping EMAIL notification");
            return;
        }

        sendEmailNotification(context, userDTO, recipientEmail, subject, body, instituteId, placeholders);
    }

    private void sendEmailNotification(EnrolmentContext context, UserDTO userDTO,
            String recipientEmail, String subject, String body, String instituteId,
            Map<String, String> placeholders) {
        log.info("--- SENDING EMAIL ---");
        log.info("TO: {}", recipientEmail);
        log.info("SUBJECT: {}", subject);
        log.info("BODY: {}", body);
        log.info("--- END EMAIL ---");

        NotificationDTO notificationDTO = new NotificationDTO();
        notificationDTO.setNotificationType(NotificationType.EMAIL.name());
        notificationDTO.setBody(body);
        notificationDTO.setSubject(subject);
        notificationDTO.setSource("daily_enrollment_check");
        // Deterministic sourceId for deduplication: same user+date+userPlan = same sourceId
        String today = new java.text.SimpleDateFormat("yyyy-MM-dd").format(new java.util.Date());
        String userPlanId = context.getUserPlan() != null ? context.getUserPlan().getId() : "unknown";
        notificationDTO.setSourceId("enrollment_" + userPlanId + "_" + today);

        NotificationToUserDTO notificationToUserDTO = new NotificationToUserDTO();
        notificationToUserDTO.setChannelId(recipientEmail);
        notificationToUserDTO.setUserId(userDTO.getId());

        Map<String, String> dynamicParams = new HashMap<>(placeholders);
        notificationToUserDTO.setPlaceholders(dynamicParams);

        java.util.List<NotificationToUserDTO> recipients = new java.util.ArrayList<>();
        recipients.add(notificationToUserDTO);
        billingContactRecipientResolver
                .buildBillingContactRecipient(userDTO.getId(), instituteId, recipientEmail)
                .ifPresent(billing -> {
                    // Reuse the same template placeholders so the renewal CTA / expiry date
                    // render identically in the billing-contact copy.
                    billing.setPlaceholders(new HashMap<>(dynamicParams));
                    recipients.add(billing);
                });
        notificationDTO.setUsers(recipients);
        notificationService.sendEmailViaUnified(notificationDTO, instituteId);
    }

    /**
     * Builds the placeholder values for one UserPlan. The same map is substituted into the
     * template here and handed to the unified send as recipient variables, so the learner
     * copy and the billing-contact copy always render identically.
     */
    private Map<String, String> buildPlaceholders(EnrolmentContext context, String instituteId) {
        UserDTO userDTO = context.getUser();
        String learnerName = userDTO != null && StringUtils.hasText(userDTO.getFullName())
                ? userDTO.getFullName().trim()
                : "Learner";
        String[] nameParts = learnerName.split("\\s+", 2);

        // Get course name from first mapping (all belong to same UserPlan)
        String courseName = context.getMappings() != null && !context.getMappings().isEmpty()
            ? enrollmentTemplateService.formatCourseName(context.getMappings().get(0).getPackageSession())
            : "Your Course";

        Map<String, String> placeholders = new HashMap<>();
        placeholders.put("learner_name", learnerName);
        placeholders.put("first_name", nameParts[0]);
        placeholders.put("last_name", nameParts.length > 1 ? nameParts[1] : "");
        placeholders.put("course_name", courseName);
        placeholders.put("expiry_date", formatEndDate(context, "yyyy-MM-dd"));
        // Human-readable form for learner-facing copy, e.g. "14 November 2026".
        placeholders.put("expiry_date_long", formatEndDate(context, "d MMMM yyyy"));
        placeholders.put("renewal_link", "https://vacademy.io/renew"); // Hardcoded for now
        placeholders.put("practice_name", resolveSubOrgName(context));
        placeholders.put("subscription_link", buildSubscriptionLink(userDTO, instituteId));
        return placeholders;
    }

    private String formatEndDate(EnrolmentContext context, String pattern) {
        if (context.getEndDate() == null) {
            return "N/A";
        }
        SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.ENGLISH);
        if (context.getBillingZone() != null) {
            format.setTimeZone(TimeZone.getTimeZone(context.getBillingZone()));
        }
        return format.format(context.getEndDate());
    }

    /** Name of the sub-org (practice) a SUB_ORG plan was bought for; blank for individual plans. */
    private String resolveSubOrgName(EnrolmentContext context) {
        String subOrgId = context.getUserPlan() != null ? context.getUserPlan().getSubOrgId() : null;
        if (!StringUtils.hasText(subOrgId)) {
            return "";
        }
        try {
            return instituteRepository.findById(subOrgId)
                    .map(Institute::getInstituteName)
                    .orElse("");
        } catch (Exception e) {
            log.warn("Could not resolve sub-org name for {}: {}", subOrgId, e.getMessage());
            return "";
        }
    }

    /**
     * The learner portal page where a member manages (and can cancel) their subscription:
     * {@code <portal>/subscriptions/<username>}, on the same host the learner's other portal
     * links use.
     */
    private String buildSubscriptionLink(UserDTO userDTO, String instituteId) {
        if (userDTO == null || !StringUtils.hasText(userDTO.getUsername())) {
            return "";
        }
        try {
            return learnerPortalAccessService.resolvePortalBaseUrl(instituteId, userDTO.getId())
                    + "/subscriptions/"
                    + URLEncoder.encode(userDTO.getUsername(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.warn("Could not build subscription link for user {}: {}", userDTO.getId(), e.getMessage());
            return "";
        }
    }

    private String replacePlaceholders(String template, Map<String, String> placeholders) {
        if (template == null) {
            return "";
        }
        String result = template;
        for (Map.Entry<String, String> entry : placeholders.entrySet()) {
            result = result.replace("{{" + entry.getKey() + "}}",
                    entry.getValue() != null ? entry.getValue() : "");
        }
        return result;
    }
}
