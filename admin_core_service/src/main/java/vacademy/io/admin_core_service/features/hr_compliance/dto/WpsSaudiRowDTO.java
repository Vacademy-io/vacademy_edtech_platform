package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * One Saudi WPS (Mudad-style, v1) salary-file row — one per paid employee.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WpsSaudiRowDTO {

    private String employeeCode;
    private String employeeName;

    /** statutory_info.gosi_number when present (preferred), else employeeCode. */
    private String employeeId;

    private String iban;

    /** statutory_info.wps_agent_id, falling back to bankAccount.routingNumber. */
    private String bankCode;

    /**
     * Basic salary — sum of the entry's BASIC component amounts when the
     * structure defines one; falls back to totalEarnings (flagged in
     * warnings) when no BASIC component exists for the employee.
     */
    private BigDecimal basicSalary;

    /** Housing allowance — not separately tracked by payroll; 0 in v1. */
    private BigDecimal housingAllowance;

    /** otherEarnings + reimbursements. */
    private BigDecimal otherEarnings;

    /** totalDeductions. */
    private BigDecimal deductions;

    /** netPay. */
    private BigDecimal netSalary;

    private String currency;
}
