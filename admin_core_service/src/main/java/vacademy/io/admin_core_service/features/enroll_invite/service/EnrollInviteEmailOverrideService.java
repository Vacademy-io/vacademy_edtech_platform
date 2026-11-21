package vacademy.io.admin_core_service.features.enroll_invite.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteSettingDTO;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.notification.enums.NotificationTemplateType;
import vacademy.io.common.logging.SentryLogger;

import java.util.Map;
import java.util.Optional;

/**
 * Answers "does this invite replace the learner's post-payment emails with one email of its
 * own?" — {@code setting.ENROLLMENT_EMAIL_SETTING} with {@code MODE: CUSTOM_ONLY}.
 * <p>
 * Used e.g. for a print pre-order sold through an invite: the buyer should get a single
 * order-confirmation mail, not the course credential / enrollment / receipt mails.
 * <p>
 * Fails open: a missing, unparsable or mis-pointed setting (template absent, from another
 * institute, not EMAIL, empty) returns empty, so the learner still gets the institute's
 * normal emails rather than none.
 */
@Slf4j
@Service
public class EnrollInviteEmailOverrideService {

    @Autowired
    private EnrollInviteRepository enrollInviteRepository;

    @Autowired
    private TemplateRepository templateRepository;

    @Autowired
    private ObjectMapper objectMapper;

    /** The invite's CUSTOM_ONLY template, looked up by invite id (null-safe, never throws). */
    public Optional<Template> customOnlyTemplate(String enrollInviteId) {
        if (!StringUtils.hasText(enrollInviteId)) {
            return Optional.empty();
        }
        try {
            return enrollInviteRepository.findById(enrollInviteId).flatMap(this::customOnlyTemplate);
        } catch (Exception e) {
            log.warn("Could not load invite {} for its email setting; using default emails: {}",
                    enrollInviteId, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * The invite's CUSTOM_ONLY template, or empty when the invite uses the default emails.
     * Never throws: it sits on the payment-success path, which must not fail over an email choice.
     */
    public Optional<Template> customOnlyTemplate(EnrollInvite enrollInvite) {
        try {
            return resolveCustomOnlyTemplate(enrollInvite);
        } catch (Exception e) {
            log.warn("Could not resolve the email setting of invite {}; using default emails: {}",
                    enrollInvite != null ? enrollInvite.getId() : null, e.getMessage());
            return Optional.empty();
        }
    }

    private Optional<Template> resolveCustomOnlyTemplate(EnrollInvite enrollInvite) {
        if (enrollInvite == null || !StringUtils.hasText(enrollInvite.getSettingJson())) {
            return Optional.empty();
        }
        EnrollInviteSettingDTO.EnrollmentEmailSetting setting;
        try {
            EnrollInviteSettingDTO dto = objectMapper.readValue(enrollInvite.getSettingJson(),
                    EnrollInviteSettingDTO.class);
            setting = dto == null || dto.getSetting() == null ? null
                    : dto.getSetting().getEnrollmentEmailSetting();
        } catch (Exception e) {
            log.warn("Could not parse setting_json for invite {}: {}", enrollInvite.getId(), e.getMessage());
            return Optional.empty();
        }
        if (setting == null
                || !EnrollInviteSettingDTO.EnrollmentEmailSetting.MODE_CUSTOM_ONLY.equalsIgnoreCase(setting.getMode())) {
            return Optional.empty();
        }

        Optional<Template> template = StringUtils.hasText(setting.getTemplateId())
                ? templateRepository.findById(setting.getTemplateId())
                : Optional.empty();
        boolean usable = template.isPresent()
                && enrollInvite.getInstituteId() != null
                && enrollInvite.getInstituteId().equals(template.get().getInstituteId())
                && NotificationTemplateType.EMAIL.name().equalsIgnoreCase(template.get().getType())
                && StringUtils.hasText(template.get().getContent());
        if (!usable) {
            SentryLogger.logError(
                    new IllegalStateException("ENROLLMENT_EMAIL_SETTING template is not usable"),
                    "Invite CUSTOM_ONLY email falls back to default emails - template missing, "
                            + "not EMAIL, empty or from another institute",
                    Map.of("enrollInviteId", String.valueOf(enrollInvite.getId()),
                            "templateId", String.valueOf(setting.getTemplateId())));
            return Optional.empty();
        }
        return template;
    }
}
