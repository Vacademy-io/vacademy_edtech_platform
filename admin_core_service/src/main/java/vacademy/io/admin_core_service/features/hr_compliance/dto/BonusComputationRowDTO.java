package vacademy.io.admin_core_service.features.hr_compliance.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * One employee's statutory bonus line (Payment of Bonus Act, 1965):
 * bonus = min(monthly basic, 7,000) x eligible FY months x rate%.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BonusComputationRowDTO {

    private String employeeId;
    private String employeeCode;
    private String employeeName;
    private BigDecimal monthlyBasic;
    private Boolean eligible;
    /** Populated when eligible = false (wage above 21,000 ceiling, < 30 days service, ...). */
    private String ineligibleReason;
    /** Months of eligible service within the FY (0..12). */
    private Integer eligibleMonths;
    /** min(monthly basic, 7,000) — s.12 calculation ceiling. */
    private BigDecimal bonusWageBase;
    private BigDecimal computedBonus;
    private String currency;
}
