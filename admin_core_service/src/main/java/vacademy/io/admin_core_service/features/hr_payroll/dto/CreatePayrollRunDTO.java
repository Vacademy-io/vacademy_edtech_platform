package vacademy.io.admin_core_service.features.hr_payroll.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreatePayrollRunDTO {

    private String instituteId;
    private Integer month;
    private Integer year;
    private String notes;
    /** REGULAR (default) | OFF_CYCLE | FNF | BONUS */
    private String runType;
}
