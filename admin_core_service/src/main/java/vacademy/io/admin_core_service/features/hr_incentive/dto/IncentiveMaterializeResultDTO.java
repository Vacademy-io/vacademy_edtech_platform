package vacademy.io.admin_core_service.features.hr_incentive.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/** Outcome of materializing CRM incentives into payroll adjustments. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class IncentiveMaterializeResultDTO {

    /** Earning period the incentives were computed over. */
    private Integer month;
    private Integer year;
    /** Payroll period the adjustments were written to. */
    private Integer payoutMonth;
    private Integer payoutYear;

    private List<CreatedItem> created;
    private List<SkippedItem> skipped;
    /** Counsellors with revenue but no EmployeeProfile in this institute — nothing created. */
    private List<UnlinkedCounsellor> unlinkedCounsellors;

    /** Sum of the adjustment amounts actually created in this call. */
    private BigDecimal totalAmount;
    private int createdCount;
    private int skippedCount;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CreatedItem {
        private String adjustmentId;
        private String employeeId;
        private String counsellorUserId;
        private String counsellorName;
        private BigDecimal amount;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SkippedItem {
        private String employeeId;
        private String counsellorUserId;
        private String counsellorName;
        /** already_materialized | zero_incentive */
        private String reason;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class UnlinkedCounsellor {
        private String counsellorUserId;
        private String counsellorName;
        /** What the incentive would have been, for follow-up once a profile exists. */
        private BigDecimal incentive;
    }
}
