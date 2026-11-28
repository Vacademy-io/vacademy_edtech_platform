package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * Slab-wise PT summary line: every distinct PT deduction amount observed in
 * the month with the number of employees at that amount and the resulting
 * total. (State PT returns are slab-count based.)
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PtReturnSlabSummaryDTO {

    private BigDecimal ptAmount;
    private Integer employeeCount;
    private BigDecimal totalAmount;
}
