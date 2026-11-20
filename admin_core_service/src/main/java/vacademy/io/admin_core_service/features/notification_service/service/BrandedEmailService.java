package vacademy.io.admin_core_service.features.notification_service.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ThemeColorResolver;
import vacademy.io.common.institute.entity.Institute;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Sends a professional, institute-branded HTML email from the DB {@code templates}
 * store. Resolves the template by (institute, name, EMAIL) with a DEFAULT fallback
 * (the shared seeded rows), renders subject/content via {@code {{placeholder}}}
 * substitution with the caller's vars plus institute branding, and dispatches through
 * the unified send path. Reusable across features (booking, mentorship, …) so every
 * notification email looks the same and stays editable per-institute — no hardcoded HTML.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class BrandedEmailService {

    /** Global-default templates live under this pseudo institute. */
    public static final String DEFAULT_INSTITUTE_ID = "DEFAULT";
    private static final String FALLBACK_THEME_COLOR = "#333333";
    private static final String FALLBACK_SUPPORT_EMAIL = "support@vacademy.io";
    private static final String FALLBACK_LEARNER_URL = "https://learner.vacademy.io";
    private static final String EMAIL_TYPE = "TRANSACTIONAL";

    private final TemplateRepository templateRepository;
    private final InstituteRepository instituteRepository;
    private final InstituteDomainRoutingRepository domainRoutingRepository;
    private final NotificationService notificationService;

    /** True when an EMAIL template with this name exists for the institute or as the DEFAULT. */
    public boolean hasEmailTemplate(String instituteId, String templateName) {
        return resolveTemplate(instituteId, templateName) != null;
    }

    /**
     * Render + send the branded template to one recipient. Returns false (without sending)
     * when no template row exists, so callers can fall back to a plain body.
     */
    public boolean sendBrandedEmail(String instituteId, String toEmail, String recipientName,
                                    String templateName, Map<String, String> vars) {
        if (toEmail == null || toEmail.isBlank() || templateName == null || templateName.isBlank()) {
            return false;
        }
        Template template = resolveTemplate(instituteId, templateName);
        if (template == null) return false;
        try {
            InstituteContext ctx = loadInstituteContext(instituteId);
            Map<String, String> v = vars == null ? new HashMap<>() : new HashMap<>(vars);
            v.put("recipient_name", recipientName != null && !recipientName.isBlank() ? recipientName : "there");
            v.put("name", v.get("recipient_name")); // alias for templates using {{name}}
            v.put("institute_name", ctx.name);
            v.put("institute_theme_color", ctx.themeColor);
            v.put("support_email", ctx.supportEmail);
            v.putIfAbsent("cta_url", ctx.ctaUrl);
            String subject = applyPlaceholders(template.getSubject(), v);
            // Two passes so a placeholder injected by another value (e.g. a {{join_button}}
            // block that itself references {{institute_theme_color}}) still resolves.
            String body = applyPlaceholders(applyPlaceholders(template.getContent(), v), v);
            notificationService.sendHtmlEmailViaUnified(toEmail, subject, body, instituteId,
                    null, ctx.fromName, EMAIL_TYPE);
            return true;
        } catch (Exception e) {
            log.warn("branded email failed ({} / {}): {}", templateName, toEmail, e.getMessage());
            return false;
        }
    }

    // ---------------------------------------------------------------- helpers

    private Template resolveTemplate(String instituteId, String templateName) {
        try {
            Optional<Template> institute =
                    templateRepository.findByInstituteIdAndNameAndType(instituteId, templateName, "EMAIL");
            if (institute.isPresent()) return institute.get();
            return templateRepository.findByInstituteIdAndNameAndType(
                    DEFAULT_INSTITUTE_ID, templateName, "EMAIL").orElse(null);
        } catch (Exception e) {
            log.warn("branded email template lookup failed ({}): {}", templateName, e.getMessage());
            return null;
        }
    }

    private InstituteContext loadInstituteContext(String instituteId) {
        String name = "";
        String themeColor = FALLBACK_THEME_COLOR;
        String cta = FALLBACK_LEARNER_URL;
        try {
            Institute inst = instituteRepository.findById(instituteId).orElse(null);
            if (inst != null) {
                if (inst.getInstituteName() != null && !inst.getInstituteName().isBlank()) {
                    name = inst.getInstituteName();
                }
                themeColor = normalizeThemeColor(inst.getInstituteThemeCode());
            }
        } catch (Exception ignore) {
            // defaults
        }
        try {
            cta = domainRoutingRepository.findByInstituteIdAndRole(instituteId, "LEARNER")
                    .map(r -> r.getSubdomain())
                    .filter(s -> s != null && s.contains("."))
                    .map(s -> "https://" + s)
                    .orElse(FALLBACK_LEARNER_URL);
        } catch (Exception ignore) {
            // default learner url
        }
        return new InstituteContext(name, themeColor, FALLBACK_SUPPORT_EMAIL, cta,
                name.isBlank() ? null : name);
    }

    private static String normalizeThemeColor(String themeCode) {
        // Hex or a theme preset ("primary", "blue", ...) -> hex; anything else -> neutral.
        String resolved = ThemeColorResolver.resolve(themeCode);
        return resolved != null ? resolved : FALLBACK_THEME_COLOR;
    }

    private static String applyPlaceholders(String template, Map<String, String> values) {
        if (template == null || template.isEmpty()) return "";
        String out = template;
        for (Map.Entry<String, String> e : values.entrySet()) {
            out = out.replace("{{" + e.getKey() + "}}", e.getValue() == null ? "" : e.getValue());
        }
        return out;
    }

    private static final class InstituteContext {
        final String name;
        final String themeColor;
        final String supportEmail;
        final String ctaUrl;
        final String fromName;

        InstituteContext(String name, String themeColor, String supportEmail, String ctaUrl, String fromName) {
            this.name = name;
            this.themeColor = themeColor;
            this.supportEmail = supportEmail;
            this.ctaUrl = ctaUrl;
            this.fromName = fromName;
        }
    }
}
