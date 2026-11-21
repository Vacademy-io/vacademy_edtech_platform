package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/** JSON view of the monthly Professional Tax return; the CSV mirrors it. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PtReturnResponseDTO {

    private String instituteId;
    private Integer month;
    private Integer year;

    /** state_code from the tax configuration; empty when missing. */
    private String stateCode;

    /** statutory_settings.pt_registration_number; empty when missing. */
    private String ptRegistrationNumber;

    private List<PtReturnSlabSummaryDTO> slabs;
    private List<PtReturnRowDTO> rows;
    private List<String> warnings;

    private Integer employeeCount;
    private BigDecimal grandTotalPt;
}
