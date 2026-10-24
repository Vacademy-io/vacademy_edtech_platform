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

/**
 * Institute-wide end-of-service benefit (EOSB) provision report as of a date —
 * the Gulf sibling of {@link GratuityProvisionReportDTO}. Only produced for
 * institutes whose tax configuration is UAE (ARE) or Saudi Arabia (SAU).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EosbProvisionReportDTO {

    private String instituteId;
    /** Normalized ISO-3 country the report was computed under: ARE | SAU. */
    private String countryCode;
    private LocalDate asOfDate;
    private Integer employeeCount;
    /** Sum of per-row statutory liabilities (UAE rows under 1 year contribute 0). */
    private BigDecimal totalStatutoryLiability;
    /** Sum of per-row day-one accounting accruals (no UAE 1-year floor). */
    private BigDecimal totalAccountingAccrual;
    /** Sum of per-row current-band monthly run-rates. */
    private BigDecimal totalMonthlyRunRate;
    /** Dominant currency of the underlying structures (rows carry their own). */
    private String currency;
    private List<EosbProvisionRowDTO> rows;
}
