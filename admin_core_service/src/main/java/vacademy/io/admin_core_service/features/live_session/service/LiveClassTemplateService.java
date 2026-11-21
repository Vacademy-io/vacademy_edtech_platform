package vacademy.io.admin_core_service.features.live_session.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.notification.entity.NotificationEventConfig;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationSourceType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationTemplateType;
import vacademy.io.admin_core_service.features.live_session.constants.LiveClassEmailBody;
import vacademy.io.admin_core_service.features.notification.repository.NotificationEventConfigRepository;

import java.util.Map;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class LiveClassTemplateService {

    private static final String DEFAULT_SOURCE_ID = "DEFAULT";

    // Template IDs from V177 migration (on-edit: V745) — used as direct DB fallback
    private static final Map<NotificationEventType, String> DEFAULT_TEMPLATE_IDS = Map.of(
            NotificationEventType.LIVE_CLASS_ON_CREATE, "default-live-class-on-create-email",
            NotificationEventType.LIVE_CLASS_BEFORE_LIVE, "default-live-class-before-live-email",
            NotificationEventType.LIVE_CLASS_ON_LIVE, "default-live-class-on-live-email",
            NotificationEventType.LIVE_CLASS_DELETE, "default-live-class-delete-email",
            NotificationEventType.LIVE_CLASS_ON_EDIT, "default-edit-live-class-email"
    );

    private final NotificationEventConfigRepository notificationEventConfigRepository;
    private final TemplateRepository templateRepository;

    /**
     * Resolves the email template for a live class notification event.
     * Priority: institute-specific → DEFAULT event config → direct template by ID → hardcoded (always sends)
     */
    public ResolvedTemplate resolveTemplate(String instituteId, NotificationEventType eventType) {
        // 1. Try institute-specific config
        Template template = findTemplateForSource(eventType, instituteId);

        // 2. Fallback to DEFAULT config
        if (template == null) {
            template = findTemplateForSource(eventType, DEFAULT_SOURCE_ID);
        }

        // 3. Fallback: directly fetch default template by known ID
        if (template == null) {
            log.warn("No event config found for event: {} and institute: {}, trying direct template lookup", eventType, instituteId);
            template = findDefaultTemplateById(eventType);
        }

        // 4. If DB template found, use subject + body from it; fallback subject from DB if empty
        if (template != null) {
            String subject = (template.getSubject() != null && !template.getSubject().trim().isEmpty())
                    ? template.getSubject()
                    : getDefaultSubject(eventType);
            String body = (template.getContent() != null && !template.getContent().trim().isEmpty())
                    ? template.getContent()
                    : getDefaultBody(eventType);
            return new ResolvedTemplate(subject, body);
        }

        // 5. Last resort: use current template (email always sends)
        log.warn("No template found in DB for event: {} and institute: {}, using current template", eventType, instituteId);
        return new ResolvedTemplate(getDefaultSubject(eventType), getDefaultBody(eventType));
    }

    private Template findTemplateForSource(NotificationEventType eventType, String sourceId) {
        Optional<NotificationEventConfig> configOpt = notificationEventConfigRepository
                .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                        eventType,
                        NotificationSourceType.INSTITUTE,
                        sourceId,
                        NotificationTemplateType.EMAIL);

        if (configOpt.isEmpty()) {
            return null;
        }

        Optional<Template> templateOpt = templateRepository.findById(configOpt.get().getTemplateId());
        if (templateOpt.isEmpty()) {
            log.warn("Template ID {} referenced by event config {} not found", configOpt.get().getTemplateId(), configOpt.get().getId());
            return null;
        }

        return templateOpt.get();
    }

    private Template findDefaultTemplateById(NotificationEventType eventType) {
        String templateId = DEFAULT_TEMPLATE_IDS.get(eventType);
        if (templateId == null) {
            return null;
        }
        return templateRepository.findById(templateId).orElse(null);
    }

    private String getDefaultSubject(NotificationEventType eventType) {
        return switch (eventType) {
            case LIVE_CLASS_ON_CREATE -> "New Live Class Created - {{SESSION_TITLE}}";
            case LIVE_CLASS_BEFORE_LIVE -> "Get Ready! Your session begins shortly.";
            case LIVE_CLASS_ON_LIVE -> "Your Live Session has started – Join now!";
            case LIVE_CLASS_DELETE -> "Live Class Cancelled - {{SESSION_TITLE}}";
            case LIVE_CLASS_ON_EDIT -> "Live Class Rescheduled - {{SESSION_TITLE}}";
            default -> "Live Class Notification";
        };
    }

    private String getDefaultBody(NotificationEventType eventType) {
        return switch (eventType) {
            case LIVE_CLASS_DELETE -> LiveClassEmailBody.Live_Class_Delete_Email_Body;
            case LIVE_CLASS_ON_EDIT -> LiveClassEmailBody.Live_Class_Edit_Email_Body;
            case LIVE_CLASS_BEFORE_LIVE -> LiveClassEmailBody.Live_Class_Before_Live_Email_Body;
            case LIVE_CLASS_ON_LIVE -> LiveClassEmailBody.Live_Class_On_Live_Email_Body;
            default -> LiveClassEmailBody.Live_Class_Email_Body;
        };
    }

    /**
     * Simple record to hold a resolved subject + body pair.
     */
    public record ResolvedTemplate(String subject, String body) {}
}
