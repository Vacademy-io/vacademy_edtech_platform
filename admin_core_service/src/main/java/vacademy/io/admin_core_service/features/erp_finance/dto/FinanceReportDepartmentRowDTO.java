package vacademy.io.admin_core_service.features.erp_finance.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;

/**
 * One department row of the P&L snapshot payroll-cost breakdown (Phase F4b).
 * Employees whose profile has no department are reported under "Unassigned".
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class FinanceReportDepartmentRowDTO {

    /** Department name, or "Unassigned" when the employee profile has no department. */
    private String departmentName;

    /** Distinct employees with a non-HELD payroll entry in the period. */
    private Long headcount;

    /** SUM(gross_salary + COALESCE(total_employer_contributions, 0)) — employer cost. */
    private BigDecimal employerCost;

    /** SUM(net_pay) — cash out to employees. */
    private BigDecimal netPay;
}
