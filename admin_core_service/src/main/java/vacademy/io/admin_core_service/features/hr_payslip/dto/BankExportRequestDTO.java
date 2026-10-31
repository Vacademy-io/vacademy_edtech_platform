package vacademy.io.admin_core_service.features.hr_payslip.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BankExportRequestDTO {

    private String payrollRunId;
    private String format; // CSV, XLSX, or bank text templates: HDFC, ICICI, SBI
}
