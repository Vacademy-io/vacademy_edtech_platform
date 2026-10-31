package vacademy.io.admin_core_service.features.hr_tax.service.engine;

import lombok.Builder;
import lombok.Getter;

import java.math.BigDecimal;
import java.util.Map;

/**
 * One statutory scheme's monthly amounts for one employee: the employee-side
 * deduction and the employer-side contribution (either may be zero). `code`
 * doubles as the system SalaryComponent code payroll materializes it under.
 */
@Getter
@Builder
public class StatutoryItem {

    /** PF | ESI | PT (component codes PF_EMP/PF_ER etc. derive from this). */
    private final String code;
    private final String name;
    private final BigDecimal employeeMonthly;
    private final BigDecimal employerMonthly;
    /** Scheme detail for filings (e.g. PF: eps/epf split, wage base). */
    private final Map<String, Object> detail;
}
