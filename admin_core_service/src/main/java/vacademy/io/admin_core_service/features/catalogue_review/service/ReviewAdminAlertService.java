package vacademy.io.admin_core_service.features.catalogue_review.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.web.util.HtmlUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewAnswer;
import vacademy.io.admin_core_service.features.catalogue_review.entity.CatalogueReview;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The built-in alerts for a new website review, on by default for every
 * institute (no setup):
 *
 * <ul>
 *   <li><b>System alert</b> — the bell of every ADMIN lights up, always. Workflows
 *       cannot post to the bell, so this never doubles with one.</li>
 *   <li><b>Email</b> — every ADMIN gets the "Site Review Submitted - Admin
 *       Notification" template (V622; an institute's own template of that name
 *       wins), unless the institute has an ACTIVE REVIEW_SUBMITTED workflow: then
 *       that workflow is its email and this one stands down.</li>
 * </ul>
 *
 * Runs off the request thread after the review commits; every failure is
 * logged and swallowed, so a visitor's submit never depends on it.
 */
@Slf4j
@Component
public class ReviewAdminAlertService {

    static final String TEMPLATE_NAME = "Site Review Submitted - Admin Notification";
    private static final String DEFAULT_INSTITUTE_ID = "DEFAULT";
    private static final String EMAIL_TYPE = "UTILITY_EMAIL";
    private static final String FALLBACK_FROM_EMAIL = "support@vacademy.io";
    private static final String FALLBACK_THEME_COLOR = "#4F46E5";
    private static final String ADMIN_REVIEWS_PATH = "/manage-pages?reviews=list";
    private static final String FALLBACK_ADMIN_SUBDOMAIN = "admin";
    private static final int ALERT_TEXT_CHARS = 180;

    @Autowired
    private AuthService authService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private TemplateRepository templateRepository;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private InstituteDomainRoutingRepository domainRoutingRepository;

    /** Lazy: the workflow service graph is wide; keeps a back-reference from forming a startup cycle. */
    @Autowired
    @Lazy
    private WorkflowTriggerService workflowTriggerService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Async
    public void notifyAdmins(CatalogueReview review, List<ReviewAnswer> answers) {
        if (review == null || review.getId() == null || review.getInstituteId() == null) return;
        String instituteId = review.getInstituteId();
        List<UserDTO> admins;
        try {
            admins = authService.requireUsersByInstituteAndRoles(instituteId, List.of("ADMIN"));
        } catch (Exception e) {
            log.warn("Review {}: could not resolve admins of {}: {}", review.getId(), instituteId, e.getMessage());
            return;
        }
        List<String> adminIds = admins.stream().map(UserDTO::getId).filter(id -> id != null && !id.isBlank())
                .distinct().toList();
        if (adminIds.isEmpty()) return;

        Institute institute = instituteRepository.findById(instituteId).orElse(null);
        String instituteName = institute == null || institute.getInstituteName() == null ? "" : institute.getInstituteName();

        sendSystemAlert(review, adminIds, instituteName);
        if (workflowHandlesIt(review)) {
            log.info("Review {}: institute {} has its own REVIEW_SUBMITTED workflow; default email skipped",
                    review.getId(), instituteId);
            return;
        }
        sendEmails(review, answers, admins, institute, instituteName);
    }

    /* ── bell ────────────────────────────────────────────────────────── */

    private void sendSystemAlert(CatalogueReview r, List<String> adminIds, String instituteName) {
        try {
            Map<String, Object> settings = new HashMap<>();
            settings.put("priority", 2);
            settings.put("isDismissible", true);
            settings.put("showBadge", true);
            settings.put("isActive", true);
            notificationService.createSystemAlertAnnouncement(
                    r.getInstituteId(), adminIds, alertTitle(r), alertBody(r), "system",
                    instituteName.isEmpty() ? "System" : instituteName, "ADMIN", settings,
                    "SITE_REVIEW", r.getId());
        } catch (Exception e) {
            log.warn("Review {}: system alert failed: {}", r.getId(), e.getMessage());
        }
    }

    static String alertTitle(CatalogueReview r) {
        return "New review " + stars(r.getRating()) + " from " + nz(r.getReviewerName());
    }

    static String alertBody(CatalogueReview r) {
        String text = nz(r.getReviewText()).trim();
        if (text.length() > ALERT_TEXT_CHARS) text = text.substring(0, ALERT_TEXT_CHARS).trim() + "…";
        String lead = text.isEmpty() ? "Stars only, no written review." : "“" + text + "”";
        return lead + " Approve it in Website Builder → Reviews.";
    }

    /* ── email ───────────────────────────────────────────────────────── */

    private boolean workflowHandlesIt(CatalogueReview r) {
        try {
            return workflowTriggerService.hasActiveWorkflow(
                    WorkflowTriggerEvent.REVIEW_SUBMITTED.name(), r.getId(), r.getInstituteId());
        } catch (Exception e) {
            // Unknown: send the default rather than risk no email at all.
            log.warn("Review {}: workflow lookup failed, sending default email: {}", r.getId(), e.getMessage());
            return false;
        }
    }

    private void sendEmails(CatalogueReview r, List<ReviewAnswer> answers, List<UserDTO> admins,
                            Institute institute, String instituteName) {
        Optional<Template> template = templateRepository
                .findByInstituteIdAndNameAndType(r.getInstituteId(), TEMPLATE_NAME, "EMAIL")
                .or(() -> templateRepository.findByInstituteIdAndNameAndType(DEFAULT_INSTITUTE_ID, TEMPLATE_NAME, "EMAIL"));
        if (template.isEmpty()) {
            log.warn("Review {}: no '{}' email template; default email skipped", r.getId(), TEMPLATE_NAME);
            return;
        }
        Map<String, String> values = placeholders(r, answers, instituteName, themeColor(institute), reviewsUrl(r.getInstituteId()));
        String fromEmail = utilityFromEmail(institute).orElse(FALLBACK_FROM_EMAIL);
        String fromName = instituteName.isEmpty() ? null : instituteName;
        for (UserDTO admin : admins) {
            if (admin == null || admin.getEmail() == null || admin.getEmail().isBlank()) continue;
            Map<String, String> perAdmin = new HashMap<>(values);
            perAdmin.put("recipient_name", esc(admin.getFullName() == null || admin.getFullName().isBlank()
                    ? "there" : admin.getFullName()));
            try {
                notificationService.sendHtmlEmailViaUnified(admin.getEmail(),
                        apply(template.get().getSubject(), perAdmin), apply(template.get().getContent(), perAdmin),
                        r.getInstituteId(), fromEmail, fromName, EMAIL_TYPE);
            } catch (Exception e) {
                log.warn("Review {}: email to {} failed: {}", r.getId(), admin.getEmail(), e.getMessage());
            }
        }
    }

    /** Every value is HTML-escaped: reviews are visitor input. */
    static Map<String, String> placeholders(CatalogueReview r, List<ReviewAnswer> answers, String instituteName,
                                            String themeColor, String reviewsUrl) {
        Map<String, String> v = new HashMap<>();
        int rating = r.getRating() == null ? 0 : r.getRating();
        v.put("institute_name", esc(instituteName));
        v.put("institute_theme_color", esc(themeColor));
        v.put("reviewer_name", esc(nz(r.getReviewerName())));
        v.put("rating", String.valueOf(rating));
        v.put("rating_stars", stars(rating));
        String text = nz(r.getReviewText()).trim();
        v.put("review_text", text.isEmpty() ? "<em style=\"color:#6b7280;\">No written review, stars only.</em>"
                : esc(text).replace("\n", "<br>"));
        v.put("site", r.getCatalogueTag() == null || r.getCatalogueTag().isBlank() ? "" : " on " + esc(r.getCatalogueTag()));
        v.put("reviews_url", esc(reviewsUrl));

        Map<String, String> rows = new LinkedHashMap<>();
        if (!nz(r.getCourseName()).isBlank()) rows.put("Course", r.getCourseName());
        if (!nz(r.getCity()).isBlank()) rows.put("City", r.getCity());
        if (!nz(r.getDesignation()).isBlank()) rows.put("Occupation / designation", r.getDesignation());
        if (answers != null) {
            for (ReviewAnswer a : answers) {
                if (a != null && a.getValue() != null && !a.getValue().isBlank()) {
                    rows.putIfAbsent(nz(a.getLabel()).isBlank() ? nz(a.getKey()) : a.getLabel(), a.getValue());
                }
            }
        }
        StringBuilder html = new StringBuilder();
        if (!rows.isEmpty()) {
            html.append("<table cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;font-size:13px;color:#374151;\">");
            rows.forEach((label, value) -> html.append("<tr><td style=\"padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top;\">")
                    .append(esc(label)).append("</td><td style=\"padding:4px 0;\">").append(esc(value)).append("</td></tr>"));
            html.append("</table>");
        }
        v.put("details_html", html.toString());
        return v;
    }

    /** https://admin host of the institute + the Reviews deep link; "#" when it cannot be resolved. */
    private String reviewsUrl(String instituteId) {
        try {
            Optional<InstituteDomainRouting> admin = domainRoutingRepository.findByInstituteIdAndRole(instituteId, "ADMIN");
            if (admin.isPresent()) return url(admin.get().getSubdomain(), admin.get().getDomain());
            Optional<InstituteDomainRouting> learner = domainRoutingRepository.findByInstituteIdAndRole(instituteId, "LEARNER");
            if (learner.isPresent()) return url(FALLBACK_ADMIN_SUBDOMAIN, learner.get().getDomain());
        } catch (Exception e) {
            log.warn("Could not resolve admin URL for {}: {}", instituteId, e.getMessage());
        }
        return "#";
    }

    static String url(String subdomain, String domain) {
        if (domain == null || domain.isBlank()) return "#";
        String d = domain.trim().replaceAll("^https?://", "").replaceAll("/$", "");
        String sub = subdomain == null ? "" : subdomain.trim();
        String host = sub.isEmpty() || "*".equals(sub) ? d : sub + "." + d;
        String h = host.toLowerCase();
        // A dev / localhost routing row must never become a dead link in a real inbox.
        if (h.equals("localhost") || h.endsWith(".localhost") || h.startsWith("127.") || !h.contains(".")) return "#";
        return "https://" + host + ADMIN_REVIEWS_PATH;
    }

    private String themeColor(Institute institute) {
        String t = institute == null ? null : institute.getInstituteThemeCode();
        if (t == null || t.isBlank()) return FALLBACK_THEME_COLOR;
        t = t.trim();
        return t.matches("^[0-9A-Fa-f]{6}$") ? "#" + t : t;
    }

    /** institute.setting → EMAIL_SETTING.data.UTILITY_EMAIL.from, address part only. */
    private Optional<String> utilityFromEmail(Institute institute) {
        if (institute == null || institute.getSetting() == null || institute.getSetting().isBlank()) return Optional.empty();
        try {
            JsonNode from = objectMapper.readTree(institute.getSetting()).path("setting").path("EMAIL_SETTING")
                    .path("data").path("UTILITY_EMAIL").path("from");
            if (!from.isTextual() || from.asText().isBlank()) return Optional.empty();
            String raw = from.asText().trim();
            int lt = raw.indexOf('<');
            int gt = raw.indexOf('>');
            return Optional.of(lt >= 0 && gt > lt + 1 ? raw.substring(lt + 1, gt).trim() : raw);
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    static String stars(Integer rating) {
        int n = rating == null ? 0 : Math.max(0, Math.min(5, rating));
        return "★".repeat(n) + "☆".repeat(5 - n);
    }

    static String apply(String template, Map<String, String> values) {
        if (template == null) return "";
        String out = template;
        for (Map.Entry<String, String> e : values.entrySet()) {
            out = out.replace("{{" + e.getKey() + "}}", e.getValue() == null ? "" : e.getValue());
        }
        return out;
    }

    private static String esc(String s) {
        return s == null ? "" : HtmlUtils.htmlEscape(s);
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
