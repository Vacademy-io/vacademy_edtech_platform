package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * One UAE WPS SIF EDR (Employee Detail Record) — one per paid employee.
 * The downloadable SIF line is generated from these fields; {@link #netPay}
 * is JSON-only context (it feeds the SCR total but is not an EDR field).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WpsEdrRowDTO {

    private String employeeCode;
    private String employeeName;

    /** statutory_info.mol_person_id when present (preferred), else employeeCode. */
    private String personId;

    /** statutory_info.wps_agent_id, falling back to bankAccount.routingNumber. */
    private String agentId;

    private String iban;

    /** Pay period start, first of month (YYYY-MM-DD). */
    private String payStartDate;

    /** Pay period end, last of month (YYYY-MM-DD). */
    private String payEndDate;

    /** Days in period — entry totalWorkingDays (max across the month's entries). */
    private Integer daysInPeriod;

    /** Fixed income — sum of totalEarnings. */
    private BigDecimal fixedIncome;

    /** Variable income — sum of otherEarnings + reimbursements. */
    private BigDecimal variableIncome;

    /** daysOnLeave rounded to whole days. */
    private Integer leaveDays;

    /** Sum of netPay across the employee's entries (feeds the SCR total). */
    private BigDecimal netPay;

    private String currency;
}
