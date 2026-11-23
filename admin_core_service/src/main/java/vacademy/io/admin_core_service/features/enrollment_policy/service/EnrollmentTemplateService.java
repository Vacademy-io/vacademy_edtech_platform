package vacademy.io.admin_core_service.features.enrollment_policy.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.enrollment_policy.constants.EnrollmentTemplateConstants;
import vacademy.io.admin_core_service.features.enrollment_policy.enums.NotificationTriggerType;
import vacademy.io.admin_core_service.features.enrollment_policy.processor.EnrolmentContext;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

/**
 * Service for handling email templates in enrollment policy notifications.
 * Fetches templates from Templates table or uses default templates.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EnrollmentTemplateService {

    private final TemplateRepository templateRepository;

    /**
     * Default subject for a policy email that names no usable template and carries no inline
     * content. BEFORE_EXPIRY gets its own subject: access has not ended yet.
     *
     * @param placeholders the same values the notification substitutes into a template
     */
    public String getDefaultEmailSubject(NotificationTriggerType trigger, Map<String, String> placeholders) {
        return replacePlaceholders(EnrollmentTemplateConstants.defaultSubject(trigger), placeholders);
    }

    /**
     * Default body for the same case. The renew button is only rendered when
     * {@code renewal_link} has a value (the institute has a learner portal).
     */
    public String getDefaultEmailBody(NotificationTriggerType trigger, Map<String, String> placeholders) {
        boolean withRenewalLink = placeholders != null && StringUtils.hasText(placeholders.get("renewal_link"));
        return replacePlaceholders(EnrollmentTemplateConstants.defaultBody(trigger, withRenewalLink), placeholders);
    }

    /**
     * The shared learner portal (default.learner.portal.url). Institutes without a portal of their
     * own have their learners sign in there, so their links fall back to it rather than vanish.
     */
    @org.springframework.beans.factory.annotation.Value("${default.learner.portal.url:}")
    private String defaultLearnerPortalUrl;

    private String defaultPortalOrNull() {
        if (defaultLearnerPortalUrl == null || defaultLearnerPortalUrl.isBlank()) {
            return null;
        }
        String base = defaultLearnerPortalUrl.trim();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    /**
     * The institute's own learner-portal origin ({@code https://host}, no trailing slash) for
     * this plan, else the shared learner portal its learners sign in to; null only when neither
     * is configured (callers then leave the link out).
     */
    public String resolveLearnerPortalUrl(EnrolmentContext context) {
        String base = readInstitute(context, Institute::getLearnerPortalBaseUrl);
        if (!StringUtils.hasText(base)) {
            return defaultPortalOrNull();
        }
        base = base.trim();
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            base = "https://" + base;
        }
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    /** The plan's institute name for {{institute_name}}; "" when it cannot be read. */
    public String resolveInstituteName(EnrolmentContext context) {
        String name = readInstitute(context, Institute::getInstituteName);
        return name != null ? name : "";
    }

    /**
     * Reads one field of the plan's institute (all mappings of a UserPlan belong to one
     * institute, so the first mapping's is the plan's). Null when it cannot be read; the
     * institute is a lazy association, and a mail must not fail over branding.
     */
    private String readInstitute(EnrolmentContext context, Function<Institute, String> field) {
        try {
            Institute institute = context != null && context.getMappings() != null && !context.getMappings().isEmpty()
                    ? context.getMappings().get(0).getInstitute()
                    : null;
            return institute != null ? field.apply(institute) : null;
        } catch (Exception e) {
            log.warn("Could not read the institute for enrollment notification: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Formats course name from package session.
     * Format: levelName (if levelId != "DEFAULT") + packageName + sessionName (if
     * sessionId != "DEFAULT")
     */
    public String formatCourseName(PackageSession packageSession) {
        if (packageSession == null) {
            return "Course";
        }

        StringBuilder sb = new StringBuilder();

        // Level name (skip if DEFAULT)
        if (packageSession.getLevel() != null
                && !"DEFAULT".equalsIgnoreCase(packageSession.getLevel().getId())
                && StringUtils.hasText(packageSession.getLevel().getLevelName())) {
            sb.append(packageSession.getLevel().getLevelName()).append(" - ");
        }

        // Package name
        if (packageSession.getPackageEntity() != null
                && StringUtils.hasText(packageSession.getPackageEntity().getPackageName())) {
            sb.append(packageSession.getPackageEntity().getPackageName());
        }

        // Session name (skip if DEFAULT)
        if (packageSession.getSession() != null
                && !"DEFAULT".equalsIgnoreCase(packageSession.getSession().getId())
                && StringUtils.hasText(packageSession.getSession().getSessionName())) {
            if (!sb.isEmpty()) {
                sb.append(" - ");
            }
            sb.append(packageSession.getSession().getSessionName());
        }

        String result = sb.toString().trim();
        return result.isEmpty() ? "Course" : result;
    }

    /**
     * Replaces placeholders in template string.
     */
    private String replacePlaceholders(String template, Map<String, String> placeholders) {
        if (template == null) {
            return "";
        }

        String result = template;
        for (Map.Entry<String, String> entry : placeholders.entrySet()) {
            String placeholder = "{{" + entry.getKey() + "}}";
            String value = (entry.getValue() != null) ? entry.getValue() : "";
            result = result.replace(placeholder, value);
        }

        return result;
    }

    public Template findByNameAndInstituteId(String templateName,String instituteId,String type){
        Optional<Template> byInstituteIdAndNameAndType = templateRepository.findByInstituteIdAndNameAndTypeAndStatus(instituteId, templateName, type,StatusEnum.ACTIVE.name());
        return byInstituteIdAndNameAndType.orElse(null);
    }
}

