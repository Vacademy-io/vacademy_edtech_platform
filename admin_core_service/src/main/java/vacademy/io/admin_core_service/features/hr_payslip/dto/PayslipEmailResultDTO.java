package vacademy.io.admin_core_service.features.hr_payslip.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response for POST /payslips/email: per-employee outcome of the payslip
 * email fan-out for one payroll run.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PayslipEmailResultDTO {

    private Integer total;
    private Integer sent;
    private Integer failed;
    private List<EmailOutcomeDTO> outcomes;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class EmailOutcomeDTO {
        private String payslipId;
        private String employeeCode;
        private String status; // SENT / FAILED
        private String reason; // only for FAILED
    }
}
