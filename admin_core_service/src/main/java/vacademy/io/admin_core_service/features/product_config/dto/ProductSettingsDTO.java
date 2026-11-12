package vacademy.io.admin_core_service.features.product_config.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A product's settings, as the health dashboard edits them. The first block is also what other
 * services read (common ProductConfigDTO, which ignores the rest): the alert and pricing fields
 * stay here so changing them never needs a common library release.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductSettingsDTO {
    private String productKey;
    private String displayName;
    private String fromEmail;
    private String fromName;
    private String websiteUrl;
    private String contactEmail;
    private String themeColor;
    private String logoUrl;
    private String appPath;
    private String loginUrl;
    private Integer trialDays;
    private Boolean selfSignupEnabled;
    private String returnHosts;

    /** Credits a new institute of this product opens with. None keeps the platform's default. */
    private Integer demoCredits;
    /** Comma-separated: who gets the new sign-up mail. */
    private String signupAlertEmails;
    /** Comma-separated, digits with the country code: who gets the new sign-up WhatsApp. */
    private String signupAlertWhatsapp;
    /** The approved template on the platform WhatsApp account, and its language. */
    private String signupAlertTemplate;
    private String signupAlertLanguage;
    /** The WhatsApp Business Account the template lives on. An id, not a secret. */
    private String whatsappWabaId;

    /** Paid plans shown on the product's website, in order. */
    private java.util.List<ProductPlanDTO> plans;
    /** How long a plan and its credits last, in months. */
    private Integer planValidityMonths;
    /** Price of one extra credit after a plan's credits are used, in rupees. */
    private java.math.BigDecimal extraCreditPriceInr;

    /** How this product's self sign-up differs from the default. None = the default. */
    private SignupRulesDTO signupRules;

    private String updatedBy;
    private String updatedAt;
}
