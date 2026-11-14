package vacademy.io.admin_core_service.features.product_config.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

/**
 * What a product's website and sign-up page may show about its free trial. Only these fields leave
 * the server: no sender address, alert recipients or WhatsApp ids. All of it is set on the health dashboard.
 */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PublicProductOfferDTO {
    private String product;
    private String displayName;
    private Integer trialDays;
    /** AI credits a new sign-up opens with; null = the platform's default. */
    private Integer demoCredits;
    private Boolean selfSignupEnabled;
    private java.util.List<ProductPlanDTO> plans;
    private Integer planValidityMonths;
    private java.math.BigDecimal extraCreditPriceInr;
}
