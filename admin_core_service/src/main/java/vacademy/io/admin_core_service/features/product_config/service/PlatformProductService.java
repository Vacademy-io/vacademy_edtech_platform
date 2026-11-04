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
import vacademy.io.common.product.ProductConfigDTO;

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
    private static final Pattern PATH = Pattern.compile("^/[A-Za-z0-9/_-]*$");

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper mapper = new ObjectMapper();

    public List<ProductConfigDTO> list() {
        return jdbcTemplate.query(SELECT + "WHERE setting_key LIKE 'product.%' ORDER BY setting_key",
                (rs, n) -> toDto(rs));
    }

    public ProductConfigDTO get(String productKey) {
        return jdbcTemplate.query(SELECT + "WHERE setting_key = ?", (rs, n) -> toDto(rs), keyOf(productKey))
                .stream().findFirst()
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "No such product"));
    }

    @Transactional
    public ProductConfigDTO update(String productKey, ProductConfigDTO body, String actor) {
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
        if (jdbcTemplate.update(UPDATE, toJson(row), actor, key) == 0) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "No such product");
        }
        return get(productKey);
    }

    static void validate(ProductConfigDTO b) {
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

    private ProductConfigDTO toDto(ResultSet rs) throws SQLException {
        ProductConfigDTO dto;
        try {
            dto = mapper.readValue(rs.getString("value"), ProductConfigDTO.class);
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
