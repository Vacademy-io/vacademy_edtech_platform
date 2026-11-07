package vacademy.io.admin_core_service.features.hr_incentive.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/** CRM incentive preview: per-counsellor rows + totals for one earning month. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class IncentivePreviewDTO {

    /** Earning period (calendar month in Asia/Kolkata). */
    private Integer month;
    private Integer year;
    private BigDecimal commissionPct;
    private BigDecimal fixedPerConversion;

    /** UTC window actually queried (payment_log.created_at ∈ [from, to)), for transparency. */
    private String windowFromUtc;
    private String windowToUtc;

    private List<IncentiveRowDTO> rows;

    private BigDecimal totalRevenue;
    private long totalPayingLeads;
    private long totalPayments;
    private BigDecimal totalIncentive;
    private int counsellorCount;
    private int linkedCounsellorCount;
    private int unlinkedCounsellorCount;
}
