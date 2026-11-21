package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

/**
 * Side-view split of one installment: move {@code amount} of its UNPAID balance onto a new
 * installment falling due on {@code dueDate}. The plan total does not change.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SplitInstallmentRequestDTO {

    /** Net amount to move, at most the installment's unpaid balance. */
    private Double amount;

    /** Optional start of the new installment's window. */
    private LocalDate startDate;

    /** Required: when the new installment falls due. */
    private LocalDate dueDate;
}
