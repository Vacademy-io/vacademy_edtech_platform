package vacademy.io.admin_core_service.features.hr_payroll.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PayrollEntryDTO {

    private String id;
    private String payrollRunId;
    private String employeeId;
    private String employeeCode;
    private BigDecimal grossSalary;
    private BigDecimal totalEarnings;
    private BigDecimal totalDeductions;
    private BigDecimal totalEmployerContributions;
    private BigDecimal netPay;
    private Integer totalWorkingDays;
    private BigDecimal daysPresent;
    private BigDecimal daysAbsent;
    private BigDecimal daysOnLeave;
    private Integer daysHoliday;
    private BigDecimal overtimeHours;
    private BigDecimal arrears;
    private BigDecimal reimbursements;
    private BigDecimal loanDeduction;
    private String currency;
    private String status;
    private List<PayrollEntryComponentDTO> components;
}
