package vacademy.io.admin_core_service.features.admission_package.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * A change to one package installment — the courses' bills due on {@code dueDate} — made on
 * every course at once: move it to {@code newDueDate}, or move {@code amount} of its unpaid
 * balance onto a new installment due on {@code newDueDate}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdmissionPackageInstallmentChangeDTO {

    /** Identifies the package installment: when its bills fall due now. */
    private LocalDate dueDate;

    private LocalDate newDueDate;

    /** Split only: how much of the unpaid balance moves to the new date. */
    private BigDecimal amount;
}
