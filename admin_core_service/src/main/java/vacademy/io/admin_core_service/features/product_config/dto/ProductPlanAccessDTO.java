package vacademy.io.admin_core_service.features.product_config.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * What a product workspace (Evalezy) has bought: its plan, and from it how many users may sign in.
 * The product app shows this, and auth-service reads {@code seatLimit} before adding a user.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductPlanAccessDTO {
    /**
     * TRIAL (free trial, no plan bought), PLAN (a product plan is live), PAYMENT_PENDING (signed up to
     * buy, not paid yet), MANAGED (set up by us), NONE (not a product workspace).
     */
    public static final String STATUS_TRIAL = "TRIAL";
    public static final String STATUS_PLAN = "PLAN";
    public static final String STATUS_MANAGED = "MANAGED";
    public static final String STATUS_NONE = "NONE";
    /** Signed up through "Buy <plan>" and not paid yet: the app shows only the plan screen. */
    public static final String STATUS_PAYMENT_PENDING = "PAYMENT_PENDING";

    private String product;
    private String status;

    /** The website plan key (starter, team) when a product plan is live. */
    private String planKey;
    private String planName;
    private Integer planCredits;
    private Integer planPriceInr;
    private String planEndsAt;

    /** Users (the owner included) the workspace may have. Null: not limited here. */
    private Integer seatLimit;

    private String trialEndsAt;
    private boolean trialExpired;

    /** The product's plans, in order, so the app can offer the next one. */
    private List<ProductPlanDTO> plans;
    private Integer planValidityMonths;
    private java.math.BigDecimal extraCreditPriceInr;
}
