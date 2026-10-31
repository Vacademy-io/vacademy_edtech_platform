package vacademy.io.admin_core_service.features.hr_payroll.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/**
 * One row per employee whose payroll entry could not be calculated in a run
 * (V480). Replaces the former silent empty-catch: the run still completes for
 * everyone else, but failures are visible and reportable instead of vanishing.
 * Rows for a run are cleared when the run is reprocessed, rejected, or cancelled.
 */
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "hr_payroll_entry_error")
public class PayrollEntryError {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "payroll_run_id", nullable = false)
    private String payrollRunId;

    @Column(name = "employee_id", nullable = false)
    private String employeeId;

    /** CALCULATION | TAX | PERSISTENCE — where in the pipeline it failed. */
    @Column(name = "error_stage", length = 50)
    private String errorStage;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
