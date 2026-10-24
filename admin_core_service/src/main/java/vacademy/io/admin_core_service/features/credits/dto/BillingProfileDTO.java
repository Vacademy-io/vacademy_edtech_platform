package vacademy.io.admin_core_service.features.credits.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

/**
 * The institute's GST billing identity used on platform invoices (credit packs
 * and AI plans), from {@code platform_billing_profile} with the legacy
 * {@code institutes} values as fallback. Read via GET /credits/packs/billing-profile
 * (to prefill the top-up modal) and written as part of POST /purchase.
 */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BillingProfileDTO {
    private String legalName;
    private String gstin;          // 15-char, null when unregistered
    private String stateCode;      // 2-digit GST state code
    private String stateName;
    private String address;
    private String billingEmail;   // extra invoice recipient (platform_billing_profile), nullable
    private String currency;       // INR | USD — non-INR buyers skip GST fields
}
