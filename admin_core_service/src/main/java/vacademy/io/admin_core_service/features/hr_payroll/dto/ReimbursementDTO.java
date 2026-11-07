package vacademy.io.admin_core_service.features.hr_payroll.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReimbursementDTO {

    private String id;
    private String employeeId;
    private String employeeCode;
    private String instituteId;
    private String type;
    private BigDecimal amount;
    private String description;
    private String receiptFileId;
    private LocalDate expenseDate;
    private String status;
    private String approvedBy;
    private String rejectionReason;
    private String currency;
}
