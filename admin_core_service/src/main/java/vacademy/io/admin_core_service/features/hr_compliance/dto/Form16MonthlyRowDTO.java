package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;

/** One salary month inside a Form 16 Part B: amounts derived from cumulative deltas. */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Form16MonthlyRowDTO {

    private Integer month;
    private Integer year;
    private String monthName;
    /** Income paid this month = cumulative actual_income_till_date minus previous month's cumulative. */
    private BigDecimal incomePaid;
    /** TDS deducted this month = cumulative actual_tax_deducted minus previous month's cumulative. */
    private BigDecimal tdsDeducted;
}
