package vacademy.io.admin_core_service.features.hr_compliance.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** Institute-wide gratuity provision report as of a date. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class GratuityProvisionReportDTO {

    private String instituteId;
    private LocalDate asOfDate;
    private Integer employeeCount;
    private BigDecimal totalAccruedLiability;
    /** Portion of the total for employees past 4y240d (payable if they exit now). */
    private BigDecimal vestedAccruedLiability;
    /** Accounting provision carried for not-yet-vested employees. */
    private BigDecimal unvestedAccruedLiability;
    /** Sum of per-employee 4.81%-of-basic monthly run-rates. */
    private BigDecimal totalMonthlyRunRate;
    /** Dominant currency of the underlying structures (rows carry their own). */
    private String currency;
    private List<GratuityProvisionRowDTO> rows;
}
