package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@Builder
public class PaymentPlanDTO {
    private String id;
    private String name;
    private String status;
    private Integer validityInDays;
    /**
     * Boxed, not primitive. Callers such as the Edit Payment Option dialog send only the
     * fields they changed; as a primitive an omitted price deserialized as 0.0 and
     * {@code PaymentPlanService.updatePaymentPlan} wrote that straight over the stored
     * price, silently zeroing paid plans.
     */
    private Double actualPrice;
    private Double elevatedPrice;
    private String currency;
    private String description;
    private String tag;
    private String featureJson;
    private Integer memberCount;
    /**
     * Members already on another plan may switch TO this one. Only honoured when the
     * parent option's {@code planChangeAllowed} is also true.
     */
    private Boolean planChangeAllowed;
    private ReferralOptionDTO referralOption;
    private String referralOptionSMappingStatus;

    // ── Regional pricing (learner-facing reads only) ──────────────────────
    // Set when RegionalPriceResolver replaced actual/elevated price and currency with
    // the viewer's regional price; they then hold the plan's own (base) price. Null on
    // every other response, and ignored on write.
    private Double baseActualPrice;
    private Double baseElevatedPrice;
    private String baseCurrency;
    /** ISO-3166 country the regional price was resolved for. */
    private String pricingCountry;
}
