package vacademy.io.admin_core_service.features.engagement.templates;

import vacademy.io.admin_core_service.features.engagement.service.EngagementBrainClient;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The seam between engine email templates (owned by the templates track) and the brain /
 * dispatcher (owned by the CRM track). The brain lists the approved templates of an engine, picks
 * one by name and supplies its variables; the dispatcher renders it through here so the preview a
 * human reviews is exactly what is sent.
 *
 * Variables use named placeholders: {{first_name}}, {{course}}, ... in both subject and body.
 */
public interface EngagementEmailTemplateCatalog {

    /**
     * The engine's APPROVED email templates. TemplateOption.name is the template's stable name,
     * TemplateOption.body is "SUBJECT: ...\n\n" + the plain-text body, so the brain can read both.
     */
    List<EngagementBrainClient.TemplateOption> findApprovedEmailTemplates(String engineId, String instituteId);

    /** Render the engine's current APPROVED version of a template, by name. Empty = no such template. */
    Optional<RenderedEmail> render(String engineId, String instituteId, String templateName,
                                   Map<String, String> variables);

    /** Render one exact version (a task drafted on an older version keeps it). Empty = not found. */
    Optional<RenderedEmail> renderById(String templateId, String instituteId, Map<String, String> variables);

    /**
     * @param missingVariables declared variables with no non-blank value. A non-empty list means the
     *                         email must NOT be sent (edge case E2: never send "Hi ,").
     */
    record RenderedEmail(String templateId, String templateName, int version,
                         String subject, String html, String text, List<String> missingVariables) {
        public boolean sendable() {
            return missingVariables == null || missingVariables.isEmpty();
        }
    }
}
