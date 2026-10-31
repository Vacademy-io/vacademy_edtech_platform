package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;

/**
 * One deductee annexure row of a Form 24Q: one employee + one salary month of
 * the quarter with TDS &gt; 0. Amounts are cumulative deltas from
 * hr_tax_computation (income paid / TDS deducted that month). PAN unmasked —
 * HR-admin-only output.
 */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Form24QDeducteeRowDTO {

    private String employeeId;
    private String pan;
    private String name;
    private String employeeCode;
    private Integer month;
    private Integer year;
    private String monthName;
    /** Taxable income paid that month (cumulative delta). */
    private BigDecimal incomePaid;
    /** TDS deducted that month (cumulative delta). */
    private BigDecimal tdsDeducted;
    /** TDS section — salary TDS is always 192. */
    private String section;
}
