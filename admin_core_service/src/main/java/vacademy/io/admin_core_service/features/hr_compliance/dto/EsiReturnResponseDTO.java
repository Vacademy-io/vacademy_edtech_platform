package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * JSON view of the monthly ESI return. The CSV download is generated from
 * {@link #rows} only — {@link #skipped} employees (no IP number on file) are
 * excluded from the file by design.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EsiReturnResponseDTO {

    private String instituteId;
    private Integer month;
    private Integer year;

    /** statutory_settings.esi_employer_code from the tax configuration; empty when missing. */
    private String esiEmployerCode;

    private List<EsiReturnRowDTO> rows;
    private List<SkippedRow> skipped;
    private List<String> warnings;

    private Integer ipCount;
    private BigDecimal totalWages;
    private BigDecimal totalIpContribution;
    private BigDecimal totalEmployerContribution;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SkippedRow {
        private String employeeCode;
        private String employeeName;
        private String reason;
    }
}
