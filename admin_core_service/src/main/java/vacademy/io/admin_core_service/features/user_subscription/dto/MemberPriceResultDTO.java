package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class MemberPriceResultDTO {
    private String userPlanId;
    private BigDecimal previousPrice;
    private BigDecimal newPrice;
    /** The plan's own list price, for comparison. */
    private BigDecimal listPrice;
    private String currency;
    /** True when the member pays the plan's list price (no own price set). */
    private boolean usesListPrice;
    /** Autopay is on: the next automatic charge uses the new price. */
    private boolean autopayOn;
}
