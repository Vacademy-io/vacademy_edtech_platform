package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/** What a whole-plan discount would take off each installment; nothing is saved. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CpoDiscountPreviewDTO {

    private String allocation;
    /** What the admin asked for (a percentage resolved against the plan total). */
    private BigDecimal requestedAmount;
    /** What actually comes off — less than requested when not enough is left unpaid. */
    private BigDecimal resolvedAmount;
    private List<Row> installments;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Row {
        private String id;
        /** Amount off this installment. */
        private BigDecimal share;
        /** What the installment would be billed at. */
        private BigDecimal amountAfter;
    }
}
