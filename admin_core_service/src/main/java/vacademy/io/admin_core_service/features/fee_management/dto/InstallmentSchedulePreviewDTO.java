package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * What an installment schedule will write for one learner, before any CPO discount.
 * Returned by the bulk-assign dry run so the preview shows the backend's own rows.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class InstallmentSchedulePreviewDTO {

    /** Gross total of every bill, including fees that are not split. */
    private BigDecimal totalAmount;

    /** Number of bills that will be created (scheduled installments + upfront fees). */
    private Integer billCount;

    /** One entry per installment number, summed across split fee types. */
    private List<Row> installments;

    /** Fees that are not split (e.g. an admission fee), due on the first due date. */
    private List<UpfrontFee> upfrontFees;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Row {
        private Integer installmentNumber;
        private LocalDate startDate;
        private LocalDate dueDate;
        private BigDecimal amount;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class UpfrontFee {
        private String feeTypeId;
        private String feeTypeName;
        private LocalDate dueDate;
        private BigDecimal amount;
    }
}
