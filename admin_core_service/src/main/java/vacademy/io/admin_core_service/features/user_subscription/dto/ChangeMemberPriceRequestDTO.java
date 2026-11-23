package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * An admin sets the price this member pays each period (a legacy or negotiated rate),
 * instead of the plan's list price. Applies from the next charge or renewal.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ChangeMemberPriceRequestDTO {
    /** Price per period, in the membership's currency. Null = go back to the plan's list price. */
    private BigDecimal price;
    /** Required: why this member pays a different amount. */
    private String remarks;
}
