package vacademy.io.admin_core_service.features.hr_payroll.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PayrollAdjustmentDTO {

    private String id;
    private String employeeId;
    private Integer month;
    private Integer year;
    /** EARNING | DEDUCTION */
    private String type;
    private String code;
    private String label;
    private BigDecimal amount;
    private String currency;
    /** REGULAR | OFF_CYCLE | FNF | BONUS (defaults REGULAR) */
    private String runScope;
    private String source;
    private String notes;
    private String payrollEntryId;
}
