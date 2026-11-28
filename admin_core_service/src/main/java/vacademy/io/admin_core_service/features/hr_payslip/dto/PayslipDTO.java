package vacademy.io.admin_core_service.features.hr_payslip.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PayslipDTO {

    private String id;
    private String payrollEntryId;
    private String employeeId;
    private String employeeCode;
    private String instituteId;
    private Integer month;
    private Integer year;
    private String fileId;
    private String fileUrl;
    private LocalDateTime generatedAt;
    private LocalDateTime emailedAt;
    private String emailStatus;
    private String currency;
}
