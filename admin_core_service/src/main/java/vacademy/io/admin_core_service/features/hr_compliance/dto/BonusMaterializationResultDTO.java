package vacademy.io.admin_core_service.features.hr_compliance.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/** Result of materializing a statutory bonus run into payroll adjustments. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BonusMaterializationResultDTO {

    private String financialYear;
    /** Payout period the adjustments were created for. */
    private Integer month;
    private Integer year;
    private BigDecimal bonusPct;
    /** Adjustments created in this call. */
    private Integer createdCount;
    /** Employees skipped because a STATUTORY_BONUS adjustment already exists for the period. */
    private Integer skippedExistingCount;
    /** Total amount of the adjustments created in this call. */
    private BigDecimal totalAmount;
}
