package vacademy.io.admin_core_service.features.hr_payslip.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response for POST /reports/bank-export: the persisted export log (with real
 * file id) plus the entries excluded from the file for missing bank details.
 * The file itself is served by GET /reports/bank-export/{id}/download.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BankExportResultDTO {

    private BankExportDTO export;
    private List<SkippedEntryDTO> skipped;
    private Integer skippedCount;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SkippedEntryDTO {
        private String employeeCode;
        private String reason;
    }
}
