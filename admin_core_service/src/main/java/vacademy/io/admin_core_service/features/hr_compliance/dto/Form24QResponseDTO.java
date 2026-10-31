package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.List;

/** Form 24Q quarterly return data (deductor + challans + deductee annexure + totals). */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Form24QResponseDTO {

    private String financialYear;
    /** Q1..Q4 in FY terms (Q1 = Apr-Jun ... Q4 = Jan-Mar). */
    private String quarter;

    private Form24QDeductorDTO deductor;
    private List<Form24QChallanDTO> challans;
    private List<Form24QDeducteeRowDTO> deducteeRows;

    /** Sum of TDS deducted across the annexure rows. */
    private BigDecimal totalTdsDeducted;
    /** Sum of challan amounts deposited for the quarter (amount only; interest/fee excluded). */
    private BigDecimal totalChallanAmount;
    /** True when deducted TDS and deposited challan totals differ. */
    private boolean mismatch;

    /** Non-fatal issues: unconfigured statutory settings, missing PANs, no challans, ... */
    private List<String> warnings;
}
