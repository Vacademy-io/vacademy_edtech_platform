package vacademy.io.admin_core_service.features.hr_salary.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssignSalaryDTO {

    private String employeeId;
    private String templateId;
    private BigDecimal ctcAnnual;
    private LocalDate effectiveFrom;
    private String revisionReason;
    /** Optional ISO-4217 code (e.g. INR, USD); defaults to INR. */
    private String currency;
    private List<ComponentOverrideDTO> componentOverrides;
}
