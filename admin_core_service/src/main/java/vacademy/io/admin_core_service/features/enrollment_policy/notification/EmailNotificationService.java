package vacademy.io.admin_core_service.features.enrollment_policy.notification;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enrollment_policy.dto.EmailNotificationContentDTO;
import vacademy.io.admin_core_service.features.enrollment_policy.dto.NotificationConfigDTO;
import vacademy.io.admin_core_service.features.enrollment_policy.dto.NotificationPolicyDTO;
import vacademy.io.admin_core_service.features.enrollment_policy.enums.NotificationTriggerType;
import vacademy.io.admin_core_service.features.enrollment_policy.enums.NotificationType;
import vacademy.io.admin_core_service.features.enrollment_policy.processor.EnrolmentContext;
import vacademy.io.admin_core_service.features.enrollment_policy.service.EnrollmentTemplateService;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.user_subscription.service.MembershipPlaceholderService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class EmailNotificationService implements INotificationService {

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private vacademy.io.admin_core_service.features.notification_service.service.BillingContactRecipientResolver billingContactRecipientResolver;

    @Autowired
    private MembershipPlaceholderService membershipPlaceholderService;

    /** Learners on a break whose fee reminders are stopped (docs/ENROLMENT_BREAKS.md). */
    @Autowired(required = false)
    private vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard enrolmentBreakGuard;

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
        if (enrolmentBreakGuard != null && context.getUserPlan() != null
                && enrolmentBreakGuard.isFeeHeldForPlan(instituteId, context.getUserPlan().getUserId(),
                        context.getUserPlan().getId())) {
            log.info("Skipping {} email for plan {}: learner on a break with fee reminders stopped",
                    policy.getTrigger(), context.getUserPlan().getId());
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

            sendEmailForChannel(context, instituteId, channelNotification, policy.getTrigger());
        }
    }

    private void sendEmailForChannel(EnrolmentContext context, String instituteId,
            vacademy.io.admin_core_service.features.enrollment_policy.dto.ChannelNotificationDTO channelNotification,
            NotificationTriggerType trigger) {
        String templateName = channelNotification.getTemplateName();
        String subject = null;
        String body = null;
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
                // Unchanged on purpose: an institute may stop these mails by deactivating the
                // template, so a missing template sends nothing rather than a default mail.
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
                subject = enrollmentTemplateService.getDefaultEmailSubject(trigger, placeholders);
                body = enrollmentTemplateService.getDefaultEmailBody(trigger, placeholders);
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
     * copy and the billing-contact copy always render identically. The membership keys come
     * from MembershipPlaceholderService, which also serves side-view and campaign sends.
     */
    private Map<String, String> buildPlaceholders(EnrolmentContext context, String instituteId) {
        Map<String, String> placeholders = new HashMap<>(membershipPlaceholderService.forPlan(
                context.getUserPlan(), context.getUser(), instituteId, context.getBillingZone()));

        // Get course name from first mapping (all belong to same UserPlan)
        String courseName = context.getMappings() != null && !context.getMappings().isEmpty()
            ? enrollmentTemplateService.formatCourseName(context.getMappings().get(0).getPackageSession())
            : "Your Course";
        placeholders.put("course_name", courseName);
        if (context.getEndDate() == null) {
            placeholders.put("expiry_date", "N/A");
        }
        placeholders.put("institute_name", enrollmentTemplateService.resolveInstituteName(context));
        placeholders.put("renewal_link", resolveRenewalLink(context, placeholders.get("subscription_link")));
        return placeholders;
    }

    /**
     * Where "Renew" points: the learner's subscriptions page (it lists the plan with its renew
     * action). That link is built on the portal this learner actually signs in to (sub-org
     * portal, else the institute's, else the shared learner portal), so it is used whenever it
     * exists. Otherwise the institute's learner portal; empty when neither exists, and the
     * default email then omits the button.
     */
    private String resolveRenewalLink(EnrolmentContext context, String subscriptionLink) {
        if (StringUtils.hasText(subscriptionLink)) {
            return subscriptionLink;
        }
        String portalUrl = enrollmentTemplateService.resolveLearnerPortalUrl(context);
        return portalUrl == null ? "" : portalUrl;
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
