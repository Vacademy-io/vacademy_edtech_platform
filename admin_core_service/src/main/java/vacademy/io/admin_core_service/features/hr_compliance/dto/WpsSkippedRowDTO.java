package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Employee excluded from the WPS salary file (e.g. missing IBAN) with the
 * reason — surfaced in the JSON view so HR can fix the data and re-export.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WpsSkippedRowDTO {

    private String employeeCode;
    private String employeeName;
    private String reason;
}
