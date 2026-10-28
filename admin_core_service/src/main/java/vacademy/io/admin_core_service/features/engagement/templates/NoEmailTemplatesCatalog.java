package vacademy.io.admin_core_service.features.engagement.templates;

import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.service.EngagementBrainClient;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Placeholder catalog until engine email templates are stored: no engine has any, so callers keep
 * today's behaviour (the brain writes emails freely). Replaced by the real catalog service.
 */
@Service
public class NoEmailTemplatesCatalog implements EngagementEmailTemplateCatalog {

    @Override
    public List<EngagementBrainClient.TemplateOption> findApprovedEmailTemplates(String engineId, String instituteId) {
        return List.of();
    }

    @Override
    public Optional<RenderedEmail> render(String engineId, String instituteId, String templateName,
                                          Map<String, String> variables) {
        return Optional.empty();
    }

    @Override
    public Optional<RenderedEmail> renderById(String templateId, String instituteId, Map<String, String> variables) {
        return Optional.empty();
    }
}
