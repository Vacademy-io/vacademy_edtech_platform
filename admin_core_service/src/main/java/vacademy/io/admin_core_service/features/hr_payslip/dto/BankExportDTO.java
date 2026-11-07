package vacademy.io.admin_core_service.features.hr_payslip.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BankExportDTO {

    private String id;
    private String payrollRunId;
    private String instituteId;
    private String fileId;
    private String fileName;
    private String format;
    private Integer totalRecords;
    private BigDecimal totalAmount;
    private String generatedBy;
    private LocalDateTime generatedAt;
    private String currency;
}
