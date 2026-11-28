package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/** One insured person's line of the monthly ESI return. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EsiReturnRowDTO {

    private String employeeCode;

    /** ESIC IP number — statutory_info key esi_number (fallback ip_number). */
    private String ipNumber;

    private String name;

    /**
     * Paid days for the month = round HALF_UP of (days_present + days_on_leave):
     * ESIC wants days for which wages were payable, and paid leave counts.
     */
    private Integer daysWorked;

    /** Gross salary of the month (ESI wages). */
    private BigDecimal monthlyWage;

    /** Employee (IP) ESI contribution — the ESI component amount. */
    private BigDecimal ipContribution;

    /** Employer ESI contribution — the ESI_ER component amount. */
    private BigDecimal employerContribution;
}
