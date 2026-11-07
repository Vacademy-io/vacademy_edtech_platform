package vacademy.io.admin_core_service.features.hr_payroll.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PayrollRunDTO {

    private String id;
    private String instituteId;
    private Integer month;
    private Integer year;
    private LocalDate runDate;
    private String status;
    private String runType;
    private Integer totalEmployees;
    private BigDecimal totalGross;
    private BigDecimal totalDeductions;
    private BigDecimal totalNetPay;
    private BigDecimal totalEmployerCost;
    private String currency;
    private String processedBy;
    private LocalDateTime processedAt;
    private String approvedBy;
    private LocalDateTime approvedAt;
    private String notes;
}
