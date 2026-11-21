package vacademy.io.admin_core_service.features.notification.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.notification.entity.NotificationEventConfig;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationSourceType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationTemplateType;
import vacademy.io.admin_core_service.features.notification.repository.NotificationEventConfigRepository;
import vacademy.io.admin_core_service.features.parent_link.dto.CredentialTemplateConfigDTO;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Reads and writes the "which template does this institute use for this event on this channel"
 * binding in {@code notification_event_config}.
 *
 * <p>Every event that lets an admin choose a template needs the same three operations, and each
 * one that grew its own copy (guardian credentials, then learner credentials, now password
 * resets) also re-derived the same two rules: upsert rather than insert, so the
 * "latest active row wins" lookup can never race several rows for one pair; and carry the
 * template NAME on WhatsApp bindings only, because WhatsApp dispatches by the
 * provider-approved name while email resolves subject and body from the Template row.
 * Getting either wrong is silent — a duplicate row sends the wrong template, a missing name
 * makes WhatsApp reject the send — so they live here once.
 */
@Service
@RequiredArgsConstructor
public class NotificationTemplateBindingService {

    private final NotificationEventConfigRepository configRepository;
    private final TemplateRepository templateRepository;

    /** The template bound for this (event, institute, channel), or an all-null DTO if none is. */
    public CredentialTemplateConfigDTO get(
            NotificationEventType event, String instituteId, NotificationTemplateType channel) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("instituteId is required");
        }
        return get(event, NotificationSourceType.INSTITUTE, instituteId, channel);
    }

    /** The template bound for this (event, source, channel), or an all-null DTO if none is. */
    public CredentialTemplateConfigDTO get(NotificationEventType event, NotificationSourceType sourceType,
                                           String sourceId, NotificationTemplateType channel) {
        NotificationEventConfig config = configRepository
                .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                        event, sourceType, sourceId, channel)
                .orElse(null);
        if (config == null || !StringUtils.hasText(config.getTemplateId())) {
            return CredentialTemplateConfigDTO.builder().build();
        }
        Template template = templateRepository.findById(config.getTemplateId()).orElse(null);
        return CredentialTemplateConfigDTO.builder()
                .templateId(config.getTemplateId())
                .templateName(template != null ? template.getName() : null)
                .templateSubject(template != null ? template.getSubject() : null)
                .build();
    }

    /** Points this (event, institute, channel) at a template, reactivating the row if it was cleared. */
    public void set(NotificationEventType event, String instituteId,
                    NotificationTemplateType channel, String templateId) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(templateId)) {
            throw new VacademyException("instituteId and templateId are required");
        }
        set(event, NotificationSourceType.INSTITUTE, instituteId, channel, templateId);
    }

    /** Points this (event, source, channel) at a template, reactivating the row if it was cleared. */
    public void set(NotificationEventType event, NotificationSourceType sourceType, String sourceId,
                    NotificationTemplateType channel, String templateId) {
        Template template = templateRepository.findById(templateId)
                .orElseThrow(() -> new VacademyException("Template not found: " + templateId));

        NotificationEventConfig config = configRepository
                .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeOrderByUpdatedAtDesc(
                        event, sourceType, sourceId, channel)
                .orElseGet(() -> new NotificationEventConfig(
                        event, sourceType, sourceId, channel, null));
        config.setTemplateId(templateId);
        config.setTemplateName(channel == NotificationTemplateType.WHATSAPP ? template.getName() : null);
        config.setIsActive(true);
        configRepository.save(config);
    }

    /** Clears the binding so the channel stops sending for this event. */
    public void clear(NotificationEventType event, String instituteId, NotificationTemplateType channel) {
        clear(event, NotificationSourceType.INSTITUTE, instituteId, channel);
    }

    /** Clears the binding for this (event, source, channel). */
    public void clear(NotificationEventType event, NotificationSourceType sourceType, String sourceId,
                      NotificationTemplateType channel) {
        configRepository
                .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeOrderByUpdatedAtDesc(
                        event, sourceType, sourceId, channel)
                .ifPresent(config -> {
                    config.setIsActive(false);
                    configRepository.save(config);
                });
    }
}
