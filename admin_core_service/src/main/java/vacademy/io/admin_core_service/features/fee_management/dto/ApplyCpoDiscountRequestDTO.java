package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.Map;

/**
 * Side-view request to apply/modify/remove the whole-CPO discount on a UserPlan.
 *
 * <ul>
 *   <li>{@code discount != null} → apply or modify.</li>
 *   <li>{@code discount == null && remove=true} → remove existing discount.</li>
 *   <li>{@code discount == null && remove=false} → 400.</li>
 * </ul>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ApplyCpoDiscountRequestDTO {

    private DiscountSpecDTO discount;
    private boolean remove;

    /**
     * How to spread the discount over the installments (CpoDiscountAllocator modes:
     * ALL_PROPORTIONAL, UNPAID_PROPORTIONAL, UNPAID_EQUAL, LAST_FIRST, NEXT_FIRST, CUSTOM).
     * Null = ALL_PROPORTIONAL, the original behaviour.
     */
    private String allocation;

    /** For CUSTOM: installment (sfp) id → amount off it. The discount is their sum. */
    private Map<String, BigDecimal> customShares;
}
