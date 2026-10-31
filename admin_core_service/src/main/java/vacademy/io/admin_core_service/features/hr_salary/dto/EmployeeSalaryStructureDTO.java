package vacademy.io.admin_core_service.features.hr_salary.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EmployeeSalaryStructureDTO {

    private String id;
    private String employeeId;
    private String employeeCode;
    private String templateId;
    private String templateName;
    private LocalDate effectiveFrom;
    private LocalDate effectiveTo;
    private BigDecimal ctcAnnual;
    private BigDecimal ctcMonthly;
    private BigDecimal grossMonthly;
    private BigDecimal netMonthly;
    private String currency;
    private String status;
    private String revisionReason;
    private List<EmployeeSalaryComponentDTO> components;
}
