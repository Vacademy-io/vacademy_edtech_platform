package vacademy.io.common.product;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/** A product sold under its own name: its row in ai_platform_settings, key product.&lt;key&gt;. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductConfigDTO {
    private String productKey;
    private String displayName;
    private String fromEmail;
    private String fromName;
    private String websiteUrl;
    private String contactEmail;
    private String themeColor;
    private String logoUrl;
    private String appPath;
    /** The login link in the welcome mail; none keeps the platform's. */
    private String loginUrl;
    private Integer trialDays;
    private Boolean selfSignupEnabled;
    /** Comma-separated hosts a sign-up may return to; a host also covers its subdomains. */
    private String returnHosts;
    private String updatedBy;
    private String updatedAt;

    /** For a mail's From header. */
    public String formattedFrom() {
        return fromName + " <" + fromEmail + ">";
    }

    public boolean isSignupOpen() {
        return Boolean.TRUE.equals(selfSignupEnabled);
    }

    public boolean allowsReturnTo(String host) {
        if (host == null || returnHosts == null) {
            return false;
        }
        String h = host.toLowerCase(Locale.ROOT);
        List<String> allowed = Arrays.stream(returnHosts.split(","))
                .map(s -> s.trim().toLowerCase(Locale.ROOT)).filter(s -> !s.isEmpty()).toList();
        return allowed.stream().anyMatch(a -> h.equals(a) || h.endsWith("." + a));
    }
}
