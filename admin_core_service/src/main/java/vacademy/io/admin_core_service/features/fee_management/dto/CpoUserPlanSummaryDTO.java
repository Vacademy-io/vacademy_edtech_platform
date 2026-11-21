package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.Date;

/**
 * Compact summary the side-view uses to list a user's CPO UserPlans before
 * drilling into any one of them. Avoids loading per-installment payloads
 * for every plan up front.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CpoUserPlanSummaryDTO {

    private String userPlanId;
    private String cpoId;
    private String cpoName;
    private String paymentOptionId;
    private String paymentOptionName;
    private String status;

    /**
     * Currency this plan is billed in, off the plan's PaymentPlan. Without it the side-view
     * card had no choice but to assume a rupee symbol for every institute.
     */
    private String currency;

    private BigDecimal grossTotal;
    private BigDecimal netTotal;
    private BigDecimal paidTotal;
    private BigDecimal outstandingTotal;
    private Integer installmentCount;

    private Date startDate;
    private Date endDate;

    /** The admission package this course was enrolled in with others, if any. */
    private String admissionPackageId;
}
