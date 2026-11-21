package vacademy.io.admin_core_service.features.product_config.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.AutoLeadListProvisioner;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.admin_core_service.features.product_config.dto.SignupEventDTO;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Every self sign-up of a product (Evalezy: the free-trial page with email or Google, "Buy &lt;plan&gt;",
 * and the instant-demo page) becomes a lead in our own CRM: one list, "Product &lt;name&gt; ( Instant -
 * Demo )" unless renamed, in the institute set on the health dashboard ({@code demo_leads_institute_id}).
 * The "Sign-up Method" column says which way the person came in. The list is created when that setting
 * is saved (and again on the first lead if it is missing); it is found by its link in setting_json, so
 * renaming it in the CRM is safe. A list an admin paused or deleted is left alone. Best-effort: a
 * failure is logged and never reaches the sign-up.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProductDemoLeadService {

    /** campaign_type of the list, and the type of its link in setting_json. */
    public static final String CAMPAIGN_TYPE = "Instant Demo";
    /** audience_response.source_type of a lead from the instant-demo page. */
    static final String SOURCE_TYPE = "PRODUCT_DEMO";
    /** audience_response.source_type of a lead from any other sign-up (trial, Buy). */
    static final String SIGNUP_SOURCE_TYPE = "PRODUCT_SIGNUP";
    /** SignupEventDTO.method that auth-service sends for the one-screen demo. */
    public static final String DEMO_METHOD = "Demo portal";

    static final String FIELD_WORKSPACE = "Workspace Id";
    static final String FIELD_TRIAL_ENDS = "Trial Ends";
    static final String FIELD_SOURCE = "Source";
    static final String FIELD_METHOD = "Sign-up Method";

    /** What a lead (audience_response) id looks like. */
    private static final java.util.regex.Pattern LEAD_ID = java.util.regex.Pattern.compile("^[A-Za-z0-9-]{1,64}$");

    /** At most this many institutes per backfill call. */
    static final int MAX_BACKFILL = 50;

    /** Name, email and phone take orders 0..2 on a lead form. */
    private static final int FIRST_EXTRA_ORDER = 3;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private final PlatformProductService products;
    private final AutoLeadListProvisioner provisioner;
    private final AudienceService audienceService;
    private final JdbcTemplate jdbcTemplate;
    private final AuthService authService;
    private final UtmAttributionService utmAttribution;

    public static boolean isDemo(SignupEventDTO event) {
        return event != null && DEMO_METHOD.equalsIgnoreCase(event.getMethod());
    }

    static String listName(ProductSettingsDTO p) {
        if (StringUtils.hasText(p.getDemoLeadsListName())) return p.getDemoLeadsListName().trim();
        String name = StringUtils.hasText(p.getDisplayName()) ? p.getDisplayName().trim() : p.getProductKey();
        return "Product " + name + " ( Instant - Demo )";
    }

    /** The product's sign-up lead list, created if needed; empty when the product has no target institute. */
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
                        + " sign-up: free trial (email or Google), Buy, and the instant-demo page"));
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
            if (event == null || !StringUtils.hasText(event.getEmail())) return null;
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
            put(values, list, FIELD_SOURCE, event.getSource(), order++);
            put(values, list, FIELD_METHOD, event.getMethod(), order);
            String result = audienceService.submitLeadToAutoList(list, event.getFullName(), event.getEmail().trim(),
                    event.getPhone(), values, isDemo(event) ? SOURCE_TYPE : SIGNUP_SOURCE_TYPE,
                    event.getInstituteId());
            log.info("[demo-leads] {}: {} ({}) -> list {}: {}", productKey, event.getEmail(), event.getMethod(),
                    list.getId(), result);
            try {
                recordUtm(list, event, result);
            } catch (Exception e) {
                // The lead is already saved; a missing UTM record must not change what the capture reports.
                log.warn("[demo-leads] {}: utm of {} not recorded: {}", productKey, event.getEmail(), e.getMessage());
            }
            return result;
        } catch (Exception e) {
            log.warn("[demo-leads] {}: lead for {} not captured: {}", productKey,
                    event == null ? null : event.getEmail(), e.getMessage(), e);
            return null;
        }
    }

    /**
     * The visit's utm tags go to the CRM's own UTM record (utm_attribution), which the lead list shows as
     * UTM Source / Campaign; the Source field keeps the page the sign-up started from. The record is tied
     * to the lead's user, read from the lead row the capture returned, because the list looks UTM up by
     * user. Without that row (a repeat sign-up) it is tied to the email. Never fails the capture.
     */
    void recordUtm(Audience list, SignupEventDTO event, String leadId) {
        Map<String, String> utm = new LinkedHashMap<>();
        putIfText(utm, "utm_source", event.getUtmSource());
        putIfText(utm, "utm_medium", event.getUtmMedium());
        putIfText(utm, "utm_campaign", event.getUtmCampaign());
        putIfText(utm, "utm_content", event.getUtmContent());
        putIfText(utm, "utm_term", event.getUtmTerm());
        if (utm.isEmpty()) return;
        String userId = null;
        // The capture returns the lead's id, or a sentence (e.g. "already captured") that is not worth a query.
        if (leadId != null && LEAD_ID.matcher(leadId).matches()) {
            try {
                userId = jdbcTemplate.query("SELECT user_id FROM audience_response WHERE id = ? AND audience_id = ?",
                        (rs, n) -> rs.getString(1), leadId, list.getId()).stream().findFirst().orElse(null);
            } catch (Exception e) {
                log.warn("[demo-leads] lead {} user not read for its utm: {}", leadId, e.getMessage());
            }
        }
        utmAttribution.record(list.getInstituteId(), userId, event.getEmail().trim(), event.getPhone(),
                "AUDIENCE", list.getId(), utm);
    }

    private static void putIfText(Map<String, String> map, String key, String value) {
        if (StringUtils.hasText(value)) map.put(key, value.trim());
    }

    /**
     * Sign-ups made before every sign-up became a lead: add the named institutes of this product to the
     * list, from what the institute row and its owner's account still hold. How they signed up and the
     * page source were never stored, so "Sign-up Method" says the lead was added later. Sends nothing
     * and fires no sign-up alert; a person already in the list is skipped by the list's own dedup.
     *
     * @return one row per institute id: the institute, email and what the capture said
     */
    public List<Map<String, String>> backfill(String productKey, List<String> instituteIds) {
        List<String> ids = instituteIds == null ? List.of() : new ArrayList<>(new LinkedHashSet<>(instituteIds.stream()
                .filter(StringUtils::hasText).map(String::trim).toList()));
        if (ids.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Give the institute ids to add");
        }
        if (ids.size() > MAX_BACKFILL) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "At most " + MAX_BACKFILL + " institutes at a time");
        }
        List<Map<String, String>> out = new ArrayList<>();
        for (String id : ids) {
            Map<String, String> row = new LinkedHashMap<>();
            row.put("institute_id", id);
            List<Map<String, Object>> found = jdbcTemplate.queryForList(
                    "SELECT name, email, mobile_number, lead_tag, demo_expires_at FROM institutes WHERE id = ? AND product = ?",
                    id, productKey);
            if (found.isEmpty()) {
                row.put("result", "not a " + productKey + " sign-up");
                out.add(row);
                continue;
            }
            SignupEventDTO event = eventFor(id, found.get(0));
            row.put("email", event.getEmail());
            if (!StringUtils.hasText(event.getEmail())) {
                row.put("result", "no email on the institute or its owner");
                out.add(row);
                continue;
            }
            String result = capture(productKey, event);
            row.put("result", result == null ? "not captured (see the admin-core log)" : result);
            out.add(row);
        }
        log.info("[demo-leads] {}: backfill of {} institutes: {}", productKey, ids.size(), out);
        return out;
    }

    /** The sign-up as auth-service would have reported it, rebuilt from the institute and its owner. */
    private SignupEventDTO eventFor(String instituteId, Map<String, Object> institute) {
        String instituteEmail = text(institute.get("email"));
        UserDTO owner = owner(instituteId, instituteEmail);
        String email = StringUtils.hasText(instituteEmail) ? instituteEmail : owner == null ? null : owner.getEmail();
        String phone = owner != null && StringUtils.hasText(owner.getMobileNumber()) ? owner.getMobileNumber()
                : text(institute.get("mobile_number"));
        String name = owner != null && StringUtils.hasText(owner.getFullName()) ? owner.getFullName()
                : text(institute.get("name"));
        Object ends = institute.get("demo_expires_at");
        String trialEnds = ends instanceof Timestamp t ? DAY.format(t.toInstant().atZone(ZoneOffset.UTC)) : null;
        String leadTag = text(institute.get("lead_tag"));
        String method = "LEAD".equalsIgnoreCase(leadTag) ? "Buy (added later)"
                : "FREE_TRIAL".equalsIgnoreCase(leadTag) ? "Trial sign-up (added later)"
                : "Sign-up (added later)";
        return SignupEventDTO.builder()
                .instituteId(instituteId)
                .instituteName(text(institute.get("name")))
                .fullName(name)
                .email(email)
                .phone(phone)
                .method(method)
                .trialEnds(trialEnds)
                .build();
    }

    /** The institute's ADMIN whose email is the institute's, else its first ADMIN; null when auth has none. */
    private UserDTO owner(String instituteId, String instituteEmail) {
        List<UserDTO> admins = authService.getUsersByInstituteAndRoles(instituteId, List.of("ADMIN"));
        if (admins == null || admins.isEmpty()) return null;
        return admins.stream()
                .filter(u -> u != null && StringUtils.hasText(instituteEmail) && instituteEmail.equalsIgnoreCase(u.getEmail()))
                .findFirst()
                .orElse(admins.get(0));
    }

    private static String text(Object value) {
        return value == null || !StringUtils.hasText(value.toString()) ? null : value.toString().trim();
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
