package vacademy.io.admin_core_service.features.product_config.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.AutoLeadListProvisioner;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.admin_core_service.features.product_config.dto.SignupEventDTO;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Every instant-demo sign-up of a product (Evalezy /demo) becomes a lead in our own CRM: one list,
 * "Product &lt;name&gt; ( Instant - Demo )", in the institute set on the health dashboard
 * ({@code demo_leads_institute_id}). The list is created when that setting is saved (and again on
 * the first lead if it is missing); it is found by its link in setting_json, so renaming it in the
 * CRM is safe. A list an admin paused or deleted is left alone. Best-effort: a failure is logged
 * and never reaches the sign-up.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProductDemoLeadService {

    /** campaign_type of the list, and the type of its link in setting_json. */
    public static final String CAMPAIGN_TYPE = "Instant Demo";
    /** audience_response.source_type of the leads. */
    static final String SOURCE_TYPE = "PRODUCT_DEMO";
    /** SignupEventDTO.method that auth-service sends for the one-screen demo. */
    public static final String DEMO_METHOD = "Demo portal";

    static final String FIELD_WORKSPACE = "Workspace Id";
    static final String FIELD_TRIAL_ENDS = "Trial Ends";
    static final String FIELD_SOURCE = "Source";

    /** Name, email and phone take orders 0..2 on a lead form. */
    private static final int FIRST_EXTRA_ORDER = 3;

    private final PlatformProductService products;
    private final AutoLeadListProvisioner provisioner;
    private final AudienceService audienceService;
    private final JdbcTemplate jdbcTemplate;

    public static boolean isDemo(SignupEventDTO event) {
        return event != null && DEMO_METHOD.equalsIgnoreCase(event.getMethod());
    }

    static String listName(ProductSettingsDTO p) {
        if (StringUtils.hasText(p.getDemoLeadsListName())) return p.getDemoLeadsListName().trim();
        String name = StringUtils.hasText(p.getDisplayName()) ? p.getDisplayName().trim() : p.getProductKey();
        return "Product " + name + " ( Instant - Demo )";
    }

    /** The product's demo lead list, created if needed; empty when the product has no target institute. */
    public Optional<Audience> ensureList(ProductSettingsDTO p) {
        if (p == null || !StringUtils.hasText(p.getDemoLeadsInstituteId())) return Optional.empty();
        String instituteId = p.getDemoLeadsInstituteId().trim();
        Integer found = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM institutes WHERE id = ?", Integer.class,
                instituteId);
        if (found == null || found == 0) {
            log.warn("[demo-leads] {}: institute {} not found, no list", p.getProductKey(), instituteId);
            return Optional.empty();
        }
        return Optional.of(provisioner.getOrCreateNamed(instituteId, CAMPAIGN_TYPE, p.getProductKey(), listName(p),
                "Every " + (StringUtils.hasText(p.getDisplayName()) ? p.getDisplayName() : p.getProductKey())
                        + " instant-demo sign-up (name, email, phone from the /demo page)"));
    }

    /** Settings were saved: create the list now, so the team sees it before the first lead. */
    public void ensureListQuietly(ProductSettingsDTO p) {
        try {
            ensureList(p).ifPresent(list -> log.info("[demo-leads] {}: list {} ({}) ready",
                    p.getProductKey(), list.getId(), list.getCampaignName()));
        } catch (Exception e) {
            log.warn("[demo-leads] {}: list not created: {}", p == null ? null : p.getProductKey(), e.getMessage());
        }
    }

    /** @return what the lead capture said (lead id or a reason), or null when nothing was attempted */
    public String capture(String productKey, SignupEventDTO event) {
        try {
            if (!isDemo(event) || !StringUtils.hasText(event.getEmail())) return null;
            ProductSettingsDTO p = products.find(productKey).orElse(null);
            Audience list = ensureList(p).orElse(null);
            if (list == null) return null;
            if (StringUtils.hasText(list.getStatus()) && !"ACTIVE".equalsIgnoreCase(list.getStatus())) {
                log.info("[demo-leads] {}: list {} is {}, lead skipped", productKey, list.getId(), list.getStatus());
                return null;
            }
            Map<String, String> values = new LinkedHashMap<>();
            int order = FIRST_EXTRA_ORDER;
            put(values, list, FIELD_WORKSPACE, event.getInstituteId(), order++);
            put(values, list, FIELD_TRIAL_ENDS, event.getTrialEnds(), order++);
            put(values, list, FIELD_SOURCE, event.getSource(), order);
            String result = audienceService.submitLeadToAutoList(list, event.getFullName(), event.getEmail().trim(),
                    event.getPhone(), values, SOURCE_TYPE, event.getInstituteId());
            log.info("[demo-leads] {}: {} -> list {}: {}", productKey, event.getEmail(), list.getId(), result);
            return result;
        } catch (Exception e) {
            log.warn("[demo-leads] {}: lead for {} not captured: {}", productKey,
                    event == null ? null : event.getEmail(), e.getMessage(), e);
            return null;
        }
    }

    private void put(Map<String, String> values, Audience list, String field, String value, int order) {
        if (!StringUtils.hasText(value)) return;
        try {
            String fieldId = provisioner.ensureField(list.getInstituteId(), list.getId(), field, order);
            if (fieldId != null) values.put(fieldId, value.trim());
        } catch (Exception e) {
            log.warn("[demo-leads] field '{}' not added to list {}: {}", field, list.getId(), e.getMessage());
        }
    }
}
