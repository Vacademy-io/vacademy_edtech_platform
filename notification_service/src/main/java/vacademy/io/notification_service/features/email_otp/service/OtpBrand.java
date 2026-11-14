package vacademy.io.notification_service.features.email_otp.service;

import org.springframework.util.StringUtils;
import vacademy.io.common.product.ProductConfigDTO;

/**
 * How a product's OTP mail looks, from its settings in the super-admin portal. The caller only
 * names a product: those settings decide the address, so nobody can pick a sender.
 */
public record OtpBrand(String from, String name, String url, String contactEmail, String theme) {

    private static final String DEFAULT_THEME = "#ED7424";

    public static OtpBrand of(ProductConfigDTO product) {
        return new OtpBrand(
                product.formattedFrom(),
                product.getDisplayName(),
                StringUtils.hasText(product.getWebsiteUrl()) ? product.getWebsiteUrl() : "",
                StringUtils.hasText(product.getContactEmail()) ? product.getContactEmail() : product.getFromEmail(),
                StringUtils.hasText(product.getThemeColor()) ? product.getThemeColor() : DEFAULT_THEME);
    }
}
