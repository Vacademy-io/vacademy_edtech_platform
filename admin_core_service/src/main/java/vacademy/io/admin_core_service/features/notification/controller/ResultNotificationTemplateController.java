package vacademy.io.admin_core_service.features.notification.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationSourceType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationTemplateType;
import vacademy.io.admin_core_service.features.notification.service.NotificationTemplateBindingService;
import vacademy.io.admin_core_service.features.parent_link.dto.CredentialTemplateConfigDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Which email / WhatsApp template goes out when an assessment's results are released.
 * Bound per institute, optionally overridden per assessment; when nothing is bound the
 * seeded DEFAULT email template is used, so learners always get an email.
 */
@RestController
@RequiredArgsConstructor
public class ResultNotificationTemplateController {

    private static final NotificationEventType EVENT = NotificationEventType.ASSESSMENT_RESULT_RELEASED;

    private final NotificationTemplateBindingService bindings;
    private final TemplateRepository templates;
    private final InstituteAccessValidator access;

    // ── Admin ──

    /** The binding at one level: the assessment's own when assessmentId is given, else the institute's. */
    @GetMapping("/admin-core-service/assessment-result-notification/v1/template")
    public ResponseEntity<CredentialTemplateConfigDTO> get(@RequestAttribute("user") CustomUserDetails user,
                                                           @RequestParam String instituteId,
                                                           @RequestParam NotificationTemplateType channel,
                                                           @RequestParam(required = false) String assessmentId) {
        access.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(StringUtils.hasText(assessmentId)
                ? bindings.get(EVENT, NotificationSourceType.ASSESSMENT, assessmentId, channel)
                : bindings.get(EVENT, instituteId, channel));
    }

    @PostMapping("/admin-core-service/assessment-result-notification/v1/template")
    public ResponseEntity<Void> set(@RequestAttribute("user") CustomUserDetails user,
                                    @RequestParam String instituteId,
                                    @RequestParam NotificationTemplateType channel,
                                    @RequestParam String templateId,
                                    @RequestParam(required = false) String assessmentId) {
        access.requireInstituteAdmin(user, instituteId);
        Template template = templates.findById(templateId).orElseThrow(() -> new VacademyException("Template not found"));
        if (!instituteId.equals(template.getInstituteId()) && !"DEFAULT".equals(template.getInstituteId())) {
            throw new VacademyException("Template belongs to another institute");
        }
        if (!channel.name().equalsIgnoreCase(template.getType())) {
            throw new VacademyException("This is a " + template.getType() + " template, not " + channel);
        }
        if (StringUtils.hasText(assessmentId)) {
            bindings.set(EVENT, NotificationSourceType.ASSESSMENT, assessmentId, channel, templateId);
        } else {
            bindings.set(EVENT, instituteId, channel, templateId);
        }
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/admin-core-service/assessment-result-notification/v1/template")
    public ResponseEntity<Void> clear(@RequestAttribute("user") CustomUserDetails user,
                                      @RequestParam String instituteId,
                                      @RequestParam NotificationTemplateType channel,
                                      @RequestParam(required = false) String assessmentId) {
        access.requireInstituteAdmin(user, instituteId);
        if (StringUtils.hasText(assessmentId)) {
            bindings.clear(EVENT, NotificationSourceType.ASSESSMENT, assessmentId, channel);
        } else {
            bindings.clear(EVENT, instituteId, channel);
        }
        return ResponseEntity.ok().build();
    }

    // ── Internal (assessment_service, HMAC) ──

    /**
     * The template to send for this assessment on this channel: the assessment's own binding,
     * else the institute's, else the DEFAULT one. A binding to another institute's template is
     * ignored. Empty body (204) when nothing applies (normal for WhatsApp).
     */
    @GetMapping("/admin-core-service/internal/v1/assessment-result-notification/resolve")
    public ResponseEntity<Map<String, Object>> resolve(@RequestParam("institute_id") String instituteId,
                                                       @RequestParam(value = "assessment_id", required = false) String assessmentId,
                                                       @RequestParam("template_type") NotificationTemplateType channel) {
        Object[][] levels = {
                {NotificationSourceType.ASSESSMENT, assessmentId, "ASSESSMENT"},
                {NotificationSourceType.INSTITUTE, instituteId, "INSTITUTE"},
                {NotificationSourceType.INSTITUTE, "DEFAULT", "DEFAULT"},
        };
        for (Object[] level : levels) {
            String sourceId = (String) level[1];
            if (!StringUtils.hasText(sourceId)) continue;
            CredentialTemplateConfigDTO bound = bindings.get(EVENT, (NotificationSourceType) level[0], sourceId, channel);
            if (bound == null || !StringUtils.hasText(bound.getTemplateId())) continue;
            Template t = templates.findById(bound.getTemplateId()).orElse(null);
            if (t == null || "INACTIVE".equalsIgnoreCase(t.getStatus())) continue;
            if (!instituteId.equals(t.getInstituteId()) && !"DEFAULT".equals(t.getInstituteId())) continue;
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("template_id", t.getId());
            out.put("name", t.getName());
            out.put("type", t.getType());
            out.put("subject", t.getSubject());
            out.put("content", t.getContent());
            out.put("content_type", t.getContentType());
            out.put("setting_json", t.getSettingJson());
            out.put("dynamic_parameters", t.getDynamicParameters());
            out.put("level", level[2]);
            return ResponseEntity.ok(out);
        }
        return ResponseEntity.noContent().build();
    }
}
