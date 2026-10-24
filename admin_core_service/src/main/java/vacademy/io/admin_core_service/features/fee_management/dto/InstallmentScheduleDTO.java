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
 * A learner's installment schedule, chosen by the admin at enrollment instead of taking the
 * fee plan's fixed template. See docs/CPO_FLEXIBLE_INSTALLMENTS.md.
 *
 * <p>Either give the rule ({@code count}, {@code interval}, {@code firstDueDate}) and let the
 * backend generate the rows, or send the final {@code rows} after the admin edited the
 * preview. When rows are sent they win; amounts in them are gross (before any CPO discount)
 * and must add up to the plan's total. A row with no amount takes the generated amount, but
 * a schedule must either give every amount or none.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class InstallmentScheduleDTO {

    /** Number of installments. Optional when {@code rows} is given. */
    private Integer count;

    /** Gap between installments. Required unless {@code rows} is given. */
    private IntervalDTO interval;

    /** Due date of installment #1. Required unless {@code rows} is given. */
    private LocalDate firstDueDate;

    /** Final rows after admin edits, in installment order. */
    private List<RowDTO> rows;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class IntervalDTO {
        /** {@code DAYS} or {@code MONTHS}. */
        private String unit;
        private Integer value;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RowDTO {
        private LocalDate dueDate;
        /** Gross amount of this installment; null = use the generated equal share. */
        private BigDecimal amount;
        /**
         * Amount of the plan discount taken off this installment. When any row has one, the
         * enrollment's plan discount is exactly these amounts (stored as fixed per-installment
         * shares) instead of being spread in proportion; null/0 = nothing off this one.
         */
        private BigDecimal discount;
    }
}
