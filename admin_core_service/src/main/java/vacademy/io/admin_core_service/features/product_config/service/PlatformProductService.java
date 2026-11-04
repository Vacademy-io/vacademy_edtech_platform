package vacademy.io.admin_core_service.features.product_config.service;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.product_config.entity.PlatformProduct;
import vacademy.io.admin_core_service.features.product_config.repository.PlatformProductRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.product.ProductConfigDTO;

import java.sql.Timestamp;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
public class PlatformProductService {

    private static final Pattern EMAIL = Pattern.compile("^[^@\\s<>\"]+@[^@\\s<>\"]+\\.[^@\\s<>\"]{2,}$");
    /** No line breaks or address punctuation: this goes into a mail header. */
    private static final Pattern FROM_NAME = Pattern.compile("^[^\\r\\n<>\"@]{1,100}$");
    private static final Pattern COLOR = Pattern.compile("^#[0-9A-Fa-f]{6}$");
    private static final Pattern HOSTS = Pattern.compile("^[a-z0-9.-]+(\\s*,\\s*[a-z0-9.-]+)*$");
    private static final Pattern PATH = Pattern.compile("^/[A-Za-z0-9/_-]*$");

    private final PlatformProductRepository repository;

    public List<ProductConfigDTO> list() {
        return repository.findAll().stream().map(PlatformProductService::toDto).toList();
    }

    public ProductConfigDTO get(String productKey) {
        return repository.findById(productKey.toLowerCase(Locale.ROOT)).map(PlatformProductService::toDto)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "No such product"));
    }

    @Transactional
    public ProductConfigDTO update(String productKey, ProductConfigDTO body, String actor) {
        PlatformProduct row = repository.findById(productKey.toLowerCase(Locale.ROOT))
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "No such product"));
        validate(body);
        row.setDisplayName(body.getDisplayName().trim());
        row.setFromEmail(body.getFromEmail().trim().toLowerCase(Locale.ROOT));
        row.setFromName(body.getFromName().trim());
        row.setWebsiteUrl(emptyToNull(body.getWebsiteUrl()));
        row.setContactEmail(emptyToNull(body.getContactEmail()));
        row.setThemeColor(emptyToNull(body.getThemeColor()));
        row.setLogoUrl(emptyToNull(body.getLogoUrl()));
        row.setAppPath(body.getAppPath().trim());
        row.setLoginUrl(emptyToNull(body.getLoginUrl()));
        row.setTrialDays(body.getTrialDays());
        row.setSelfSignupEnabled(Boolean.TRUE.equals(body.getSelfSignupEnabled()));
        row.setReturnHosts(emptyToNull(body.getReturnHosts()));
        row.setUpdatedBy(actor);
        row.setUpdatedAt(new Timestamp(System.currentTimeMillis()));
        return toDto(repository.save(row));
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

    private static String emptyToNull(String v) {
        return StringUtils.hasText(v) ? v.trim() : null;
    }

    static ProductConfigDTO toDto(PlatformProduct p) {
        return ProductConfigDTO.builder()
                .productKey(p.getProductKey()).displayName(p.getDisplayName())
                .fromEmail(p.getFromEmail()).fromName(p.getFromName())
                .websiteUrl(p.getWebsiteUrl()).contactEmail(p.getContactEmail())
                .themeColor(p.getThemeColor()).logoUrl(p.getLogoUrl()).appPath(p.getAppPath()).loginUrl(p.getLoginUrl())
                .trialDays(p.getTrialDays()).selfSignupEnabled(p.getSelfSignupEnabled())
                .returnHosts(p.getReturnHosts()).updatedBy(p.getUpdatedBy())
                .updatedAt(p.getUpdatedAt() == null ? null : p.getUpdatedAt().toInstant().toString())
                .build();
    }
}
