package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * One member line of the EPFO ECR v2 file (all wage/contribution figures are
 * whole rupees, as the portal expects).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PfEcrRowDTO {

    private String employeeCode;
    private String uan;
    private String memberName;

    /** Gross wages paid in the month (rupees, HALF_UP). */
    private BigDecimal grossWages;

    /** Recovered PF wage base = round(PF employee contribution / 0.12). */
    private BigDecimal epfWages;
    private BigDecimal epsWages;
    private BigDecimal edliWages;

    /** Employee 12% share — the PF component amount as deducted in payroll. */
    private BigDecimal epfContriRemitted;

    /** EPS 8.33% of the recovered wage base (HALF_UP rupee). */
    private BigDecimal epsContriRemitted;

    /** Employer 12% of the recovered base minus EPS. */
    private BigDecimal epfEpsDiffRemitted;

    /** Non-contributory period days = days_absent, rounded HALF_UP. */
    private Integer ncpDays;

    private BigDecimal refundOfAdvances;
}
