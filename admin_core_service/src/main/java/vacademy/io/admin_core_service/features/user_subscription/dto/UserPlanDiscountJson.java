package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Serialized into {@code user_plan.discount_json}. Audit snapshot of every
 * discount or manual amount override applied to a CPO UserPlan's installments.
 *
 * <p>Does not drive amount math — each StudentFeePayment row already carries
 * its net (post-discount) {@code amount_expected}. This payload exists so
 * the side-view can render "what was applied and why" and so future
 * re-modifications can replay the history.
 *
 * <p>Shape (snake_case via Jackson):
 * <pre>
 * {
 *   "cpo_discount":            { type, value, resolved_amount, allocation, shares, reason, applied_by, applied_at },
 *   "installment_discounts":   { "&lt;sfpId&gt;": { aft_installment_id, type, value, resolved_amount, reason, applied_by, applied_at } },
 *   "manual_amount_overrides": { "&lt;sfpId&gt;": { previous_amount, new_amount, reason, applied_by, applied_at } },
 *   "history":                 [ { action, scope, target_id, before, after, by, at } ]
 * }
 * </pre>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UserPlanDiscountJson {

    private DiscountEntry cpoDiscount;

    @Builder.Default
    private Map<String, InstallmentDiscountEntry> installmentDiscounts = new LinkedHashMap<>();

    @Builder.Default
    private Map<String, ManualAmountOverrideEntry> manualAmountOverrides = new LinkedHashMap<>();

    @Builder.Default
    private List<HistoryEntry> history = new ArrayList<>();

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DiscountEntry {
        private String type;            // PERCENTAGE | FLAT
        private Double value;           // raw input — % or absolute
        private BigDecimal resolvedAmount;
        /**
         * How the discount is spread (CpoDiscountAllocator modes). Null = the original way:
         * every installment in proportion, re-derived on each edit.
         */
        private String allocation;
        /** sfpId → amount off, frozen when the discount was applied. Null when {@code allocation} is null. */
        private Map<String, BigDecimal> shares;
        private String reason;
        private String appliedBy;
        private LocalDateTime appliedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class InstallmentDiscountEntry {
        private String aftInstallmentId;
        private String type;
        private Double value;
        private BigDecimal resolvedAmount;
        private String reason;
        private String appliedBy;
        private LocalDateTime appliedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ManualAmountOverrideEntry {
        private BigDecimal previousAmount;
        private BigDecimal newAmount;
        private String reason;
        private String appliedBy;
        private LocalDateTime appliedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class HistoryEntry {
        /** APPLY | MODIFY | REMOVE | AMOUNT_OVERRIDE | DATE_OVERRIDE */
        private String action;
        /** CPO | INSTALLMENT */
        private String scope;
        /** SFP id for INSTALLMENT actions; null for CPO. */
        private String targetId;
        private Object before;
        private Object after;
        private String by;
        private LocalDateTime at;
    }
}
