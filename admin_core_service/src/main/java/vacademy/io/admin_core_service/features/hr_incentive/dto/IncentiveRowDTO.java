package vacademy.io.admin_core_service.features.hr_incentive.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * One counsellor's collected revenue + computed incentive for the earning period.
 * Employee linkage: {@code employeeId} when the counsellor's auth userId maps to an
 * HR EmployeeProfile in this institute, else {@code noEmployeeProfile = true}
 * (listed and flagged, but skipped from materialization).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class IncentiveRowDTO {

    private String counsellorUserId;
    private String counsellorName;
    private String employeeId;
    private boolean noEmployeeProfile;

    /** Collected revenue attributed to this counsellor in the window (PAID payments of CONVERTED leads). */
    private BigDecimal revenue;
    /** Distinct paying converted leads = "conversions" for the fixed-per-conversion component. */
    private long payingLeads;
    private long payments;

    /** revenue × commissionPct / 100 (0 when commissionPct absent). */
    private BigDecimal commissionComponent;
    /** fixedPerConversion × payingLeads (0 when fixedPerConversion absent). */
    private BigDecimal fixedComponent;
    /** commissionComponent + fixedComponent, 2dp HALF_UP. */
    private BigDecimal incentive;
}
