package vacademy.io.admin_core_service.features.hr_compliance.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * One employee's gratuity accrual line (Payment of Gratuity Act, 1972 s.4):
 * accrued liability = (15/26) x monthly basic x rounded years of service,
 * capped at the Act's Rs 20,00,000 ceiling.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class GratuityProvisionRowDTO {

    private String employeeId;
    private String employeeCode;
    private String employeeName;
    private String employmentStatus;
    private LocalDate joinDate;
    /** Service measurement end: asOfDate, or lastWorkingDate if earlier. */
    private LocalDate serviceEndDate;
    /** True when the employee exited within the asOf month (still provisioned). */
    private Boolean exitedInAsOfMonth;
    /** Decimal years of service (days / 365.2425), 2dp. */
    private BigDecimal rawYears;
    /**
     * Completed years, with a part in excess of six months rounded up to a full
     * year once past the 5-year mark (s.4(2): "or part thereof in excess of six months").
     */
    private Integer roundedYears;
    private BigDecimal monthlyBasic;
    /** BASIC_COMPONENT | GROSS_FALLBACK (50% of gross) | NONE (no ACTIVE structure). */
    private String basicSource;
    /** (15/26) x monthlyBasic x roundedYears, capped at 20,00,000. */
    private BigDecimal accruedLiability;
    private Boolean cappedAtCeiling;
    /** Service >= 4 years + 240 days (Mettur Beardsell, Madras HC). */
    private Boolean vested;
    /** Monthly provision run-rate: 4.81% of monthly basic. */
    private BigDecimal monthlyRunRate;
    private String currency;
}
