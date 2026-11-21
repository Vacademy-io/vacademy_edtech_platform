package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.databind.annotation.JsonNaming;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

/**
 * Stop dues on an installment — a learner who dropped out or stopped paying: the installment (or
 * it and every later one) stops being owed, and optionally the learner is removed from the
 * course. On a package, {@code dueDate} names the package installment.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StopDuesRequestDTO {

    /** Package only: the package installment, by its due date. */
    private LocalDate dueDate;

    /** Also every later installment, not just this one. */
    private boolean includeLater;

    /** Required: why the dues are stopped. Kept on the installments and in the activity log. */
    private String reason;

    /** Also remove the learner from the course (hard terminate: access ends now). */
    private boolean removeFromCourse;
}
