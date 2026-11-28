package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/** One employee's line of the monthly Professional Tax return. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PtReturnRowDTO {

    private String employeeCode;
    private String name;
    private BigDecimal grossSalary;
    private BigDecimal ptAmount;
}
