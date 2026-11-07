package vacademy.io.admin_core_service.features.hr_payroll.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreateReimbursementDTO {

    private String employeeId;
    private String type;
    private BigDecimal amount;
    private String description;
    private String receiptFileId;
    private LocalDate expenseDate;
    /** Optional ISO-4217 code (e.g. INR, USD); defaults to INR. */
    private String currency;
}
