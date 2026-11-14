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
public class EmployeeLoanDTO {

    private String id;
    private String employeeId;
    private String employeeCode;
    private String instituteId;
    private String loanType;
    private BigDecimal principalAmount;
    private BigDecimal interestRate;
    private Integer tenureMonths;
    private BigDecimal emiAmount;
    private BigDecimal disbursedAmount;
    private BigDecimal balanceAmount;
    private Integer startMonth;
    private Integer startYear;
    private String status;
    private String notes;
    private String currency;
}
