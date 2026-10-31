package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * JSON view of a monthly WPS salary-file export. Exactly one of
 * {@link #edrRows} (format UAE_SIF) / {@link #saudiRows} (format SAUDI_WPS)
 * is populated; the downloadable file is generated from that list only —
 * {@link #skipped} employees (no IBAN on file) are excluded by design.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WpsExportResponseDTO {

    /** UAE_SIF or SAUDI_WPS. */
    private String format;

    private String instituteId;
    private Integer month;
    private Integer year;

    /** Tax configuration countryCode the format was resolved from (may be null on explicit override). */
    private String countryCode;

    /** statutory_settings.mol_establishment_id; empty when missing (warned). */
    private String establishmentId;

    /** statutory_settings.employer_bank_code; empty when missing (warned). */
    private String employerBankCode;

    /** statutory_settings.wps_reference; optional, empty when missing (not warned). */
    private String wpsReference;

    private List<WpsEdrRowDTO> edrRows;
    private List<WpsSaudiRowDTO> saudiRows;
    private List<WpsSkippedRowDTO> skipped;
    private List<String> warnings;

    /** Employees included in the file (skipped excluded). */
    private Integer employeeCount;

    /** Sum of netPay across included employees. */
    private BigDecimal totalNetPay;

    /** Payment currency of the file (expected AED for UAE, SAR for Saudi). */
    private String currency;
}
