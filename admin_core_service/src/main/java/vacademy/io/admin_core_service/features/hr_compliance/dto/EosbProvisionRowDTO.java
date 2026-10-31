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
 * One employee's end-of-service benefit (EOSB) accrual line for a Gulf
 * institute.
 *
 * <p>UAE (Federal Decree-Law 33/2021 art. 51): 21 days of basic per year for
 * the first 5 years of service, 30 days/year beyond, pro-rated for fractional
 * years (daily basic = monthly basic / 30); no statutory entitlement before
 * 1 year of service; total capped at 2 years' pay.
 *
 * <p>Saudi Arabia (Labor Law art. 84): half a month's basic per year for the
 * first 5 years, a full month per year beyond, pro-rated; no service floor.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EosbProvisionRowDTO {

    private String employeeId;
    private String employeeCode;
    private String employeeName;
    private String employmentStatus;
    private LocalDate joinDate;
    /** Service measurement end: asOfDate, or lastWorkingDate if earlier. */
    private LocalDate serviceEndDate;
    /** True when the employee exited within the asOf month (still provisioned). */
    private Boolean exitedInAsOfMonth;
    /** Decimal years of service (days / 365.25), 2dp. */
    private BigDecimal serviceYears;
    private BigDecimal monthlyBasic;
    /** BASIC_COMPONENT | GROSS_FALLBACK (50% of gross) | NONE (no ACTIVE structure). */
    private String basicSource;
    /**
     * EOSB payable if the employee exited on the service end date. UAE: zero
     * before 1 year of service (art. 51 floor). Saudi: no floor.
     */
    private BigDecimal statutoryLiability;
    /**
     * False only for UAE employees under 1 year of service — no statutory
     * entitlement yet, though the books still carry {@code accountingAccrual}.
     */
    private Boolean statutoryEligible;
    /**
     * Day-one accrual view (IAS 19 style): the same banded formula without the
     * UAE 1-year floor. Equals {@code statutoryLiability} once eligible.
     */
    private BigDecimal accountingAccrual;
    /** UAE only: true when the accrual hit the 2-years'-pay cap (basic x 24). */
    private Boolean cappedAtTwoYearsPay;
    /**
     * Current band's monthly accrual — UAE: daily basic x (21|30)/12;
     * Saudi: basic x (0.5|1)/12.
     */
    private BigDecimal monthlyRunRate;
    private String currency;
}
