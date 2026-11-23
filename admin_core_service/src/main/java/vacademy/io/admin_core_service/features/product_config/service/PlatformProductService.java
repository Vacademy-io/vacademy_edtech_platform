package vacademy.io.admin_core_service.features.product_config.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.admin_core_service.features.product_config.dto.ProductLinkDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductPlanDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductShortLinkDTO;
import vacademy.io.admin_core_service.features.product_config.dto.PublicProductOfferDTO;
import vacademy.io.admin_core_service.features.product_config.dto.SignupRulesDTO;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * A product's settings: one row of ai_platform_settings, key product.&lt;product_key&gt;, value JSON.
 * Which product an institute belongs to is institutes.product.
 */
@Service
@RequiredArgsConstructor
public class PlatformProductService {

    static final String KEY_PREFIX = "product.";

    private static final String SELECT =
            "SELECT setting_key, setting_value::text AS value, updated_by, updated_at FROM ai_platform_settings ";
    private static final String UPDATE =
            "UPDATE ai_platform_settings SET setting_value = ?::jsonb, updated_by = ?, updated_at = now() "
                    + "WHERE setting_key = ?";

    private static final Pattern EMAIL = Pattern.compile("^[^@\\s<>\"]+@[^@\\s<>\"]+\\.[^@\\s<>\"]{2,}$");
    /** No line breaks or address punctuation: this goes into a mail header. */
    private static final Pattern FROM_NAME = Pattern.compile("^[^\\r\\n<>\"@]{1,100}$");
    private static final Pattern COLOR = Pattern.compile("^#[0-9A-Fa-f]{6}$");
    private static final Pattern HOSTS = Pattern.compile("^[a-z0-9.-]+(\\s*,\\s*[a-z0-9.-]+)*$");
    private static final Pattern TEMPLATE_NAME = Pattern.compile("^[a-z0-9_]{1,100}$");
    private static final Pattern LANGUAGE = Pattern.compile("^[a-z]{2}(_[A-Z]{2})?$");
    private static final int MAX_DEMO_CREDITS = 100_000;
    private static final Pattern INSTITUTE_ID = Pattern.compile("^[A-Za-z0-9-]{8,64}$");
    private static final int MAX_ALERT_RECIPIENTS = 20;
    private static final Pattern PATH = Pattern.compile("^/[A-Za-z0-9/_-]*$");
    private static final Pattern PRODUCT_KEY = Pattern.compile("^[A-Za-z0-9_-]{1,40}$");
    private static final Pattern PLAN_KEY = Pattern.compile("^[a-z0-9-]{1,30}$");
    private static final int MAX_PLANS = 6;
    private static final int MAX_PLAN_NUMBER = 10_000_000;
    /** A plan for the dashboard or for API use (ProductPlanDTO.accessMode). */
    static final java.util.Set<String> ACCESS_MODES = java.util.Set.of("PLATFORM", "API");
    static final int MAX_WELCOME_LINKS = 12;
    static final int MAX_SHORT_LINKS = 50;
    /** A short link's path: it becomes a page address on the product's website. */
    private static final Pattern SHORT_CODE = Pattern.compile("^[a-z0-9][a-z0-9-]{0,29}$");
    /** A utm value as reports group it: lowercase, no spaces. */
    private static final Pattern UTM_VALUE = Pattern.compile("^[a-z0-9][a-z0-9_.-]{0,59}$");

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper mapper = new ObjectMapper();

    public List<ProductSettingsDTO> list() {
        return jdbcTemplate.query(SELECT + "WHERE setting_key LIKE 'product.%' ORDER BY setting_key",
                (rs, n) -> toDto(rs));
    }

    public ProductSettingsDTO get(String productKey) {
        return jdbcTemplate.query(SELECT + "WHERE setting_key = ?", (rs, n) -> toDto(rs), keyOf(productKey))
                .stream().findFirst()
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "No such product"));
    }

    @Transactional
    public ProductSettingsDTO update(String productKey, ProductSettingsDTO body, String actor) {
        validate(body);
        String key = keyOf(productKey);
        // Only the settings themselves: the key and who-changed-it have their own columns.
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("display_name", body.getDisplayName().trim());
        row.put("from_email", body.getFromEmail().trim().toLowerCase(Locale.ROOT));
        row.put("from_name", body.getFromName().trim());
        row.put("website_url", emptyToNull(body.getWebsiteUrl()));
        row.put("contact_email", emptyToNull(body.getContactEmail()));
        row.put("theme_color", emptyToNull(body.getThemeColor()));
        row.put("logo_url", emptyToNull(body.getLogoUrl()));
        row.put("app_path", body.getAppPath().trim());
        row.put("login_url", emptyToNull(body.getLoginUrl()));
        row.put("trial_days", body.getTrialDays());
        row.put("self_signup_enabled", Boolean.TRUE.equals(body.getSelfSignupEnabled()));
        row.put("return_hosts", emptyToNull(body.getReturnHosts()));
        // A field left out is kept, so an older dashboard cannot wipe what it does not know about.
        ProductSettingsDTO existing = get(productKey);
        row.put("demo_credits", body.getDemoCredits() != null ? body.getDemoCredits() : existing.getDemoCredits());
        row.put("demo_portal_credits", body.getDemoPortalCredits() != null
                ? body.getDemoPortalCredits() : existing.getDemoPortalCredits());
        row.put("email_logo_url", body.getEmailLogoUrl() != null
                ? emptyToNull(body.getEmailLogoUrl()) : existing.getEmailLogoUrl());
        row.put("demo_leads_institute_id", body.getDemoLeadsInstituteId() != null
                ? emptyToNull(body.getDemoLeadsInstituteId()) : existing.getDemoLeadsInstituteId());
        row.put("demo_leads_list_name", body.getDemoLeadsListName() != null
                ? emptyToNull(body.getDemoLeadsListName()) : existing.getDemoLeadsListName());
        row.put("signup_alert_emails", body.getSignupAlertEmails() != null
                ? emptyToNull(body.getSignupAlertEmails()) : existing.getSignupAlertEmails());
        row.put("signup_alert_whatsapp", body.getSignupAlertWhatsapp() != null
                ? phones(body.getSignupAlertWhatsapp()) : existing.getSignupAlertWhatsapp());
        row.put("signup_alert_template", body.getSignupAlertTemplate() != null
                ? emptyToNull(body.getSignupAlertTemplate()) : existing.getSignupAlertTemplate());
        row.put("signup_alert_language", body.getSignupAlertLanguage() != null
                ? emptyToNull(body.getSignupAlertLanguage()) : existing.getSignupAlertLanguage());
        row.put("whatsapp_waba_id", body.getWhatsappWabaId() != null
                ? emptyToNull(body.getWhatsappWabaId()) : existing.getWhatsappWabaId());
        row.put("plans", body.getPlans() != null ? cleanPlans(body.getPlans(), existing.getPlans()) : existing.getPlans());
        row.put("plan_validity_months", body.getPlanValidityMonths() != null
                ? body.getPlanValidityMonths() : existing.getPlanValidityMonths());
        row.put("extra_credit_price_inr", body.getExtraCreditPriceInr() != null
                ? body.getExtraCreditPriceInr() : existing.getExtraCreditPriceInr());
        row.put("signup_rules", body.getSignupRules() != null ? body.getSignupRules() : existing.getSignupRules());
        row.put("welcome_links", body.getWelcomeLinks() != null
                ? cleanLinks(body.getWelcomeLinks()) : existing.getWelcomeLinks());
        row.put("short_links", body.getShortLinks() != null
                ? cleanShortLinks(body.getShortLinks()) : existing.getShortLinks());
        if (jdbcTemplate.update(UPDATE, toJson(row), actor, key) == 0) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "No such product");
        }
        return get(productKey);
    }

    static void validate(ProductSettingsDTO b) {
        require(StringUtils.hasText(b.getDisplayName()), "Product name is required");
        require(b.getFromEmail() != null && EMAIL.matcher(b.getFromEmail().trim()).matches(),
                "From email must be a plain address like hello@example.com");
        require(b.getFromName() != null && FROM_NAME.matcher(b.getFromName().trim()).matches(),
                "From name cannot be empty or contain < > \" or @");
        require(!StringUtils.hasText(b.getContactEmail()) || EMAIL.matcher(b.getContactEmail().trim()).matches(),
                "Contact email is not a valid address");
        require(!StringUtils.hasText(b.getWebsiteUrl()) || b.getWebsiteUrl().trim().startsWith("https://"),
                "Website must start with https://");
        require(!StringUtils.hasText(b.getLoginUrl()) || b.getLoginUrl().trim().startsWith("https://"),
                "Login URL must start with https://");
        require(!StringUtils.hasText(b.getThemeColor()) || COLOR.matcher(b.getThemeColor().trim()).matches(),
                "Theme colour must look like #D61C28");
        require(b.getAppPath() != null && PATH.matcher(b.getAppPath().trim()).matches(),
                "App path must start with / and hold only letters, numbers, - and _");
        require(b.getTrialDays() != null && b.getTrialDays() >= 0 && b.getTrialDays() <= 365,
                "Trial days must be between 0 and 365");
        require(!StringUtils.hasText(b.getReturnHosts())
                        || HOSTS.matcher(b.getReturnHosts().trim().toLowerCase(Locale.ROOT)).matches(),
                "Return hosts must be comma-separated hosts, like vacademy.io,evalezy.com");
        validateAlerts(b);
        validatePlans(b);
        validateSignupRules(b.getSignupRules());
        validateWelcomeLinks(b.getWelcomeLinks());
        validateShortLinks(b.getShortLinks());
    }

    /** Checked as saved: trimmed and lowercased (cleanShortLinks). */
    static void validateShortLinks(List<ProductShortLinkDTO> links) {
        if (links == null) {
            return;
        }
        require(links.size() <= MAX_SHORT_LINKS, "At most " + MAX_SHORT_LINKS + " short links");
        java.util.Set<String> codes = new java.util.HashSet<>();
        for (ProductShortLinkDTO link : links) {
            require(link != null, "A short link is empty");
            String code = lower(link.getCode());
            require(code != null && SHORT_CODE.matcher(code).matches(),
                    "Short link must be 1-30 lowercase letters, numbers or -, starting with a letter or number: "
                            + link.getCode());
            require(codes.add(code), "Short link used twice: " + code);
            String source = lower(link.getSource());
            require(source != null && UTM_VALUE.matcher(source).matches(),
                    "Short link " + code + " needs a source of lowercase letters, numbers, - _ or . (no spaces)");
            String campaign = lower(link.getCampaign());
            require(campaign == null || UTM_VALUE.matcher(campaign).matches(),
                    "Short link " + code + ": the campaign can hold only lowercase letters, numbers, - _ or . (no spaces)");
        }
    }

    /** Trimmed and lowercased; blank is null. */
    private static String lower(String value) {
        return StringUtils.hasText(value) ? value.trim().toLowerCase(Locale.ROOT) : null;
    }

    static void validateWelcomeLinks(List<ProductLinkDTO> links) {
        if (links == null) {
            return;
        }
        require(links.size() <= MAX_WELCOME_LINKS, "At most " + MAX_WELCOME_LINKS + " welcome mail links");
        for (ProductLinkDTO link : links) {
            require(link != null && StringUtils.hasText(link.getTitle()) && link.getTitle().trim().length() <= 80,
                    "Every welcome mail link needs a title of up to 80 characters");
            require(link.getUrl() != null && link.getUrl().trim().startsWith("https://")
                            && link.getUrl().trim().length() <= 500 && !link.getUrl().trim().contains(" "),
                    "Welcome mail link must be an https:// address: " + link.getTitle().trim());
            require(link.getSubtitle() == null || link.getSubtitle().trim().length() <= 40,
                    "A welcome mail link note can be at most 40 characters");
        }
    }

    static void validateSignupRules(SignupRulesDTO rules) {
        if (rules == null || rules.getInstituteTypes() == null) {
            return;
        }
        require(rules.getInstituteTypes().size() <= 20, "At most 20 business types");
        for (String type : rules.getInstituteTypes()) {
            require(type != null && type.matches("^[a-z0-9_]{1,40}$"),
                    "Business types can have only small letters, numbers and _");
        }
    }

    private static void validateAlerts(ProductSettingsDTO b) {
        require(b.getDemoCredits() == null || (b.getDemoCredits() >= 0 && b.getDemoCredits() <= MAX_DEMO_CREDITS),
                "Demo credits must be between 0 and " + MAX_DEMO_CREDITS);
        require(b.getDemoPortalCredits() == null
                        || (b.getDemoPortalCredits() >= 0 && b.getDemoPortalCredits() <= MAX_DEMO_CREDITS),
                "Demo page credits must be between 0 and " + MAX_DEMO_CREDITS);
        require(!StringUtils.hasText(b.getEmailLogoUrl()) || (b.getEmailLogoUrl().trim().startsWith("https://")
                        && !b.getEmailLogoUrl().trim().toLowerCase(Locale.ROOT).endsWith(".svg")),
                "Email logo must be an https PNG or JPG link (SVG does not show in mail)");
        require(!StringUtils.hasText(b.getDemoLeadsInstituteId())
                        || INSTITUTE_ID.matcher(b.getDemoLeadsInstituteId().trim()).matches(),
                "Demo leads institute must be an institute id");
        require(!StringUtils.hasText(b.getDemoLeadsListName()) || b.getDemoLeadsListName().trim().length() <= 255,
                "Demo leads list name can be at most 255 characters");
        if (StringUtils.hasText(b.getSignupAlertEmails())) {
            String[] emails = b.getSignupAlertEmails().split(",");
            require(emails.length <= MAX_ALERT_RECIPIENTS, "At most " + MAX_ALERT_RECIPIENTS + " alert emails");
            for (String email : emails) {
                require(EMAIL.matcher(email.trim()).matches(), "Not a valid alert email: " + email.trim());
            }
        }
        if (StringUtils.hasText(b.getSignupAlertWhatsapp())) {
            String[] numbers = b.getSignupAlertWhatsapp().split(",");
            require(numbers.length <= MAX_ALERT_RECIPIENTS, "At most " + MAX_ALERT_RECIPIENTS + " alert WhatsApp numbers");
            for (String number : numbers) {
                require(number.replaceAll("[^0-9]", "").length() >= 10 && number.replaceAll("[^0-9]", "").length() <= 15,
                        "Not a valid WhatsApp number, include the country code: " + number.trim());
            }
        }
        require(!StringUtils.hasText(b.getSignupAlertTemplate()) || TEMPLATE_NAME.matcher(b.getSignupAlertTemplate().trim()).matches(),
                "Template name can have only small letters, numbers and _");
        require(!StringUtils.hasText(b.getSignupAlertLanguage()) || LANGUAGE.matcher(b.getSignupAlertLanguage().trim()).matches(),
                "Template language must look like en or en_US");
        require(!StringUtils.hasText(b.getWhatsappWabaId()) || b.getWhatsappWabaId().trim().matches("^[0-9]{5,30}$"),
                "The WhatsApp Business Account id must be digits");
    }

    static void validatePlans(ProductSettingsDTO b) {
        if (b.getPlans() != null) {
            require(b.getPlans().size() <= MAX_PLANS, "At most " + MAX_PLANS + " plans");
            java.util.Set<String> keys = new java.util.HashSet<>();
            for (ProductPlanDTO plan : b.getPlans()) {
                require(plan != null && plan.getKey() != null && PLAN_KEY.matcher(plan.getKey().trim()).matches(),
                        "Plan id must be small letters, numbers or -, like starter");
                require(keys.add(plan.getKey().trim()), "Two plans have the id " + plan.getKey().trim());
                require(StringUtils.hasText(plan.getName()) && plan.getName().trim().length() <= 40,
                        "Every plan needs a name of up to 40 characters");
                require(plan.getPriceInr() != null && plan.getPriceInr() >= 0 && plan.getPriceInr() <= MAX_PLAN_NUMBER,
                        "Plan price must be between 0 and " + MAX_PLAN_NUMBER);
                require(plan.getCredits() != null && plan.getCredits() >= 0 && plan.getCredits() <= MAX_PLAN_NUMBER,
                        "Plan credits must be between 0 and " + MAX_PLAN_NUMBER);
                require(plan.getUsers() != null && plan.getUsers() >= 1 && plan.getUsers() <= 100_000,
                        "Plan users must be at least 1");
                require(plan.getAccessMode() == null || ACCESS_MODES.contains(plan.getAccessMode().trim().toUpperCase(Locale.ROOT)),
                        "Plan access must be PLATFORM or API");
                require(plan.getValidityMonths() == null || (plan.getValidityMonths() >= 1 && plan.getValidityMonths() <= 60),
                        "Plan validity must be between 1 and 60 months");
            }
        }
        require(b.getPlanValidityMonths() == null || (b.getPlanValidityMonths() >= 1 && b.getPlanValidityMonths() <= 60),
                "Plan validity must be between 1 and 60 months");
        require(b.getExtraCreditPriceInr() == null || (b.getExtraCreditPriceInr().signum() >= 0
                        && b.getExtraCreditPriceInr().compareTo(java.math.BigDecimal.valueOf(1000)) <= 0),
                "Extra credit price must be between 0 and 1000");
    }

    private static List<ProductLinkDTO> cleanLinks(List<ProductLinkDTO> links) {
        return links.stream().map(l -> ProductLinkDTO.builder().title(l.getTitle().trim()).url(l.getUrl().trim())
                .subtitle(emptyToNull(l.getSubtitle())).build()).toList();
    }

    private static List<ProductShortLinkDTO> cleanShortLinks(List<ProductShortLinkDTO> links) {
        return links.stream().map(l -> ProductShortLinkDTO.builder().code(lower(l.getCode()))
                .source(lower(l.getSource())).campaign(lower(l.getCampaign())).build()).toList();
    }

    /**
     * The plans as saved. Access mode and validity left out are kept from the stored plan with the same
     * id, so a dashboard that does not know those fields cannot drop them.
     */
    static List<ProductPlanDTO> cleanPlans(List<ProductPlanDTO> plans, List<ProductPlanDTO> existing) {
        Map<String, ProductPlanDTO> before = new LinkedHashMap<>();
        if (existing != null) {
            existing.stream().filter(e -> e != null && e.getKey() != null)
                    .forEach(e -> before.put(e.getKey().trim(), e));
        }
        return plans.stream().map(p -> {
            String key = p.getKey().trim();
            ProductPlanDTO old = before.get(key);
            String mode = p.getAccessMode() != null ? p.getAccessMode() : old == null ? null : old.getAccessMode();
            Integer months = p.getValidityMonths() != null ? p.getValidityMonths()
                    : old == null ? null : old.getValidityMonths();
            return ProductPlanDTO.builder().key(key).name(p.getName().trim())
                    .priceInr(p.getPriceInr()).credits(p.getCredits()).users(p.getUsers())
                    .accessMode(StringUtils.hasText(mode) ? mode.trim().toUpperCase(Locale.ROOT) : null)
                    .validityMonths(months)
                    .build();
        }).toList();
    }

    /** Digits with the country code, the way numbers are stored and sent. */
    private static String phones(String list) {
        if (!StringUtils.hasText(list)) {
            return null;
        }
        return java.util.Arrays.stream(list.split(","))
                .map(n -> n.replaceAll("[^0-9]", ""))
                .filter(StringUtils::hasText)
                .collect(java.util.stream.Collectors.joining(","));
    }

    /** The public part of a product's settings, for its website and sign-up page. */
    public PublicProductOfferDTO publicOffer(String productKey) {
        if (productKey == null || !PRODUCT_KEY.matcher(productKey).matches()) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "No such product");
        }
        ProductSettingsDTO p = get(productKey.toLowerCase(Locale.ROOT));
        Map<String, SoldPlan> sold = soldPlans(p.getProductKey());
        Integer months = p.getPlanValidityMonths();
        List<ProductPlanDTO> plans = p.getPlans();
        if (plans != null && !sold.isEmpty()) {
            plans = plans.stream().map(plan -> {
                SoldPlan s = sold.get(storefrontKey(p.getProductKey(), plan.getKey()));
                return s == null ? plan : plan.toBuilder().priceInr(s.priceInr()).credits(s.credits())
                        .validityMonths(s.periodMonths() > 0 ? Integer.valueOf(s.periodMonths()) : plan.getValidityMonths())
                        .build();
            }).toList();
            months = plans.stream().map(plan -> sold.get(storefrontKey(p.getProductKey(), plan.getKey())))
                    .filter(java.util.Objects::nonNull).map(SoldPlan::periodMonths).findFirst().orElse(months);
        }
        return PublicProductOfferDTO.builder()
                .product(p.getProductKey())
                .displayName(p.getDisplayName())
                .trialDays(p.getTrialDays())
                .demoCredits(p.getDemoCredits())
                .demoPortalCredits(p.getDemoPortalCredits() != null ? p.getDemoPortalCredits() : p.getDemoCredits())
                .selfSignupEnabled(Boolean.TRUE.equals(p.getSelfSignupEnabled()))
                .plans(plans)
                .planValidityMonths(months)
                .extraCreditPriceInr(p.getExtraCreditPriceInr())
                .shortLinks(p.getShortLinks())
                .build();
    }

    /** A product plan as the storefront sells it: its latest published INR version. */
    record SoldPlan(int priceInr, int credits, int periodMonths) {
    }

    /** The storefront plan of a website plan: "&lt;product&gt;_&lt;key&gt;" (see ai_service plans_admin, product plans). */
    static String storefrontKey(String product, String planKey) {
        return (product + "_" + (planKey == null ? "" : planKey)).toLowerCase(Locale.ROOT).replace('-', '_');
    }

    /**
     * What the storefront charges for the product's plans, so the website always shows the price a buyer
     * pays. Empty when the storefront tables are missing or the product sells nothing yet (the website
     * then shows the dashboard's numbers).
     */
    Map<String, SoldPlan> soldPlans(String product) {
        Map<String, SoldPlan> out = new LinkedHashMap<>();
        if (!StringUtils.hasText(product)) {
            return out;
        }
        String like = product.toLowerCase(Locale.ROOT).replace('-', '_').replace("_", "\\_") + "\\_%";
        // Only plans offered to the product's segment: another plan may share the key prefix.
        String segment = "product_" + product.toLowerCase(Locale.ROOT);
        try {
            jdbcTemplate.query("SELECT p.plan_key, v.price_minor, v.allowance_credits, v.period_months FROM ai_plan p "
                            + "JOIN LATERAL (SELECT * FROM ai_plan_version x WHERE x.plan_id = p.id AND x.status = 'PUBLISHED' "
                            + "AND x.currency = 'INR' ORDER BY x.version_no DESC LIMIT 1) v ON true "
                            + "WHERE p.is_active AND p.listed AND p.plan_key LIKE ? ESCAPE '\\' "
                            + "AND EXISTS (SELECT 1 FROM ai_storefront_audience a WHERE a.plan_id = p.id AND a.is_active "
                            + "AND a.segment_key = ? AND upper(COALESCE(a.rule, 'INCLUDE')) = 'INCLUDE')",
                    (ResultSet rs) -> {
                        out.put(rs.getString("plan_key"), new SoldPlan(
                                (int) (rs.getLong("price_minor") / 100),
                                rs.getBigDecimal("allowance_credits").intValue(),
                                rs.getInt("period_months")));
                    }, like, segment);
        } catch (Exception e) {
            return Map.of();
        }
        return out;
    }

    /** What a new institute of this product opens with; null keeps the platform's default. */
    public Integer demoCreditsFor(String productKey) {
        if (!StringUtils.hasText(productKey) || "vacademy".equalsIgnoreCase(productKey)) {
            return null;
        }
        try {
            return jdbcTemplate.query(SELECT + "WHERE setting_key = ?", (rs, n) -> toDto(rs), keyOf(productKey))
                    .stream().findFirst().map(ProductSettingsDTO::getDemoCredits).orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * The product's sign-up rules; empty rules (Evalezy's behaviour) when it has none, is the
     * platform itself, or cannot be read.
     */
    public SignupRulesDTO signupRulesFor(String productKey) {
        if (!StringUtils.hasText(productKey) || "vacademy".equalsIgnoreCase(productKey)
                || !PRODUCT_KEY.matcher(productKey).matches()) {
            return new SignupRulesDTO();
        }
        try {
            return jdbcTemplate.query(SELECT + "WHERE setting_key = ?", (rs, n) -> toDto(rs), keyOf(productKey))
                    .stream().findFirst().map(ProductSettingsDTO::getSignupRules)
                    .orElseGet(SignupRulesDTO::new);
        } catch (Exception e) {
            return new SignupRulesDTO();
        }
    }

    /**
     * What a workspace opened from the product's one-screen demo starts with: the demo-page amount,
     * else the trial amount. Null keeps the platform's default.
     */
    public Integer demoPortalCreditsFor(String productKey) {
        if (!StringUtils.hasText(productKey) || "vacademy".equalsIgnoreCase(productKey)) {
            return null;
        }
        try {
            return jdbcTemplate.query(SELECT + "WHERE setting_key = ?", (rs, n) -> toDto(rs), keyOf(productKey))
                    .stream().findFirst()
                    .map(p -> p.getDemoPortalCredits() != null ? p.getDemoPortalCredits() : p.getDemoCredits())
                    .orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * The settings of the product an institute belongs to, when that product has its own sender
     * (Evalezy); empty for a Vacademy institute or when unknown.
     */
    public java.util.Optional<ProductSettingsDTO> productOfInstitute(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return java.util.Optional.empty();
        }
        try {
            String product = jdbcTemplate.query("SELECT product FROM institutes WHERE id = ?",
                    (rs, n) -> rs.getString(1), instituteId).stream().findFirst().orElse(null);
            if (!StringUtils.hasText(product) || "vacademy".equalsIgnoreCase(product.trim())) {
                return java.util.Optional.empty();
            }
            return find(product.trim()).filter(p -> StringUtils.hasText(p.getFromEmail())
                    && StringUtils.hasText(p.getDisplayName()));
        } catch (Exception e) {
            return java.util.Optional.empty();
        }
    }

    /** A product's settings, or empty when it has none (or they cannot be read). */
    public java.util.Optional<ProductSettingsDTO> find(String productKey) {
        if (!StringUtils.hasText(productKey)) {
            return java.util.Optional.empty();
        }
        try {
            return jdbcTemplate.query(SELECT + "WHERE setting_key = ?", (rs, n) -> toDto(rs), keyOf(productKey))
                    .stream().findFirst();
        } catch (Exception e) {
            return java.util.Optional.empty();
        }
    }

    private static void require(boolean ok, String message) {
        if (!ok) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, message);
        }
    }

    private static String keyOf(String productKey) {
        return KEY_PREFIX + productKey.toLowerCase(Locale.ROOT);
    }

    private static String emptyToNull(String v) {
        return StringUtils.hasText(v) ? v.trim() : null;
    }

    private String toJson(Map<String, Object> row) {
        try {
            return mapper.writeValueAsString(row);
        } catch (JsonProcessingException e) {
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not save the product");
        }
    }

    private ProductSettingsDTO toDto(ResultSet rs) throws SQLException {
        ProductSettingsDTO dto;
        try {
            dto = mapper.readValue(rs.getString("value"), ProductSettingsDTO.class);
        } catch (JsonProcessingException e) {
            throw new SQLException("Bad settings for " + rs.getString("setting_key"), e);
        }
        dto.setProductKey(rs.getString("setting_key").substring(KEY_PREFIX.length()));
        dto.setUpdatedBy(rs.getString("updated_by"));
        Timestamp at = rs.getTimestamp("updated_at");
        dto.setUpdatedAt(at == null ? null : at.toInstant().toString());
        return dto;
    }
}
