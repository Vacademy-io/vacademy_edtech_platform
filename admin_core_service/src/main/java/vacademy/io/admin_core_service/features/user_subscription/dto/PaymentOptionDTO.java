package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

import java.util.Date;
import java.util.List;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@Builder
public class PaymentOptionDTO {
    private String id;
    private String name;
    private String status;
    private String source;
    private String sourceId;
    private String tag;
    private String type;
    private boolean requireApproval;
    private String unit;
    /**
     * Master switch for plan change — members on another option of the same package
     * session may switch INTO this option. Boxed so a partial edit payload that omits it
     * leaves the stored value alone instead of silently turning the feature off.
     */
    private Boolean planChangeAllowed;
    /** Regional (country-based) pricing master switch. Boxed: null on edit = leave as is. */
    private Boolean regionalPricingEnabled;
    /** Currencies the system auto-prices every plan in, e.g. ["USD","GBP"]. Null on edit = leave as is. */
    private List<String> regionalPricingCurrencies;
    /** Set when type='CPO'. Points at the underlying ComplexPaymentOption row. */
    private String complexPaymentOptionId;
    private List<PaymentPlanDTO> paymentPlans;
    private String paymentOptionMetadataJson;

    // ── Read-only provenance ──────────────────────────────────────────────
    // Ignored on write: the service stamps the creator from the JWT and the
    // database stamps the timestamps. Present so the admin plan picker can
    // sort newest-first and say who added each plan.
    private String createdByUserId;
    /**
     * Display name of {@link #createdByUserId}, resolved from auth_service on the
     * list endpoint only. Null when the creator is unknown or auth_service could
     * not be reached — the UI falls back to the id.
     */
    private String createdByName;
    private Date createdAt;
    private Date updatedAt;
}
