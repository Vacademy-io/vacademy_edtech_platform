package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * JSON view of the monthly PF ECR. The downloadable ECR v2 text file is
 * generated from {@link #rows} only — {@link #skipped} members (no UAN on
 * file) are excluded from the file by design.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PfEcrResponseDTO {

    private String instituteId;
    private Integer month;
    private Integer year;

    /** statutory_settings.pf_establishment_id from the tax configuration; empty when missing. */
    private String pfEstablishmentId;

    private List<PfEcrRowDTO> rows;
    private List<SkippedRow> skipped;
    private List<String> warnings;

    private Integer memberCount;
    private BigDecimal totalEpfWages;
    private BigDecimal totalEpfContri;
    private BigDecimal totalEpsContri;
    private BigDecimal totalEpfEpsDiff;

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
