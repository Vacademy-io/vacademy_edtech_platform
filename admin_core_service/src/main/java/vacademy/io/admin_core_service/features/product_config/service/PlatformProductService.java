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
import vacademy.io.admin_core_service.features.product_config.dto.ProductPlanDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
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
    private static final int MAX_ALERT_RECIPIENTS = 20;
    private static final Pattern PATH = Pattern.compile("^/[A-Za-z0-9/_-]*$");
    private static final Pattern PRODUCT_KEY = Pattern.compile("^[A-Za-z0-9_-]{1,40}$");
    private static final Pattern PLAN_KEY = Pattern.compile("^[a-z0-9-]{1,30}$");
    private static final int MAX_PLANS = 6;
    private static final int MAX_PLAN_NUMBER = 10_000_000;

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
        row.put("plans", body.getPlans() != null ? cleanPlans(body.getPlans()) : existing.getPlans());
        row.put("plan_validity_months", body.getPlanValidityMonths() != null
                ? body.getPlanValidityMonths() : existing.getPlanValidityMonths());
        row.put("extra_credit_price_inr", body.getExtraCreditPriceInr() != null
                ? body.getExtraCreditPriceInr() : existing.getExtraCreditPriceInr());
        row.put("signup_rules", body.getSignupRules() != null ? body.getSignupRules() : existing.getSignupRules());
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
            }
        }
        require(b.getPlanValidityMonths() == null || (b.getPlanValidityMonths() >= 1 && b.getPlanValidityMonths() <= 60),
                "Plan validity must be between 1 and 60 months");
        require(b.getExtraCreditPriceInr() == null || (b.getExtraCreditPriceInr().signum() >= 0
                        && b.getExtraCreditPriceInr().compareTo(java.math.BigDecimal.valueOf(1000)) <= 0),
                "Extra credit price must be between 0 and 1000");
    }

    private static List<ProductPlanDTO> cleanPlans(List<ProductPlanDTO> plans) {
        return plans.stream().map(p -> ProductPlanDTO.builder().key(p.getKey().trim()).name(p.getName().trim())
                .priceInr(p.getPriceInr()).credits(p.getCredits()).users(p.getUsers()).build()).toList();
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
        return PublicProductOfferDTO.builder()
                .product(p.getProductKey())
                .displayName(p.getDisplayName())
                .trialDays(p.getTrialDays())
                .demoCredits(p.getDemoCredits())
                .selfSignupEnabled(Boolean.TRUE.equals(p.getSelfSignupEnabled()))
                .plans(p.getPlans())
                .planValidityMonths(p.getPlanValidityMonths())
                .extraCreditPriceInr(p.getExtraCreditPriceInr())
                .build();
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
