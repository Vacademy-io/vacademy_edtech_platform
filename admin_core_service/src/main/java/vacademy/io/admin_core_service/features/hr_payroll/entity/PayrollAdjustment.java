package vacademy.io.admin_core_service.features.hr_payroll.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * Variable-pay input (V482): a per-employee, per-month ad-hoc earning or
 * deduction — bonus, incentive, notice recovery, leave encashment, arrears.
 * Consumed by payroll processing for the matching run scope and materialized
 * as a PayrollEntryComponent under {@code code}; {@code payrollEntryId} links
 * it once consumed (cleared again if the run is rejected/cancelled).
 */
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "hr_payroll_adjustment")
public class PayrollAdjustment {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "employee_id", nullable = false)
    private String employeeId;

    @Column(name = "month", nullable = false)
    private Integer month;

    @Column(name = "year", nullable = false)
    private Integer year;

    /** EARNING | DEDUCTION */
    @Column(name = "type", nullable = false, length = 20)
    private String type;

    /** Component code it materializes under (BONUS, LEAVE_ENCASHMENT, NOTICE_RECOVERY, ...). */
    @Column(name = "code", nullable = false, length = 30)
    private String code;

    @Column(name = "label", nullable = false, length = 100)
    private String label;

    @Column(name = "amount", nullable = false, precision = 15, scale = 2)
    private BigDecimal amount;

    @Column(name = "currency", length = 3)
    private String currency;

    /** Run type that consumes it: REGULAR | OFF_CYCLE | FNF | BONUS. */
    @Column(name = "run_scope", length = 30)
    private String runScope;

    /** MANUAL | FNF | CRM_INCENTIVE | SYSTEM */
    @Column(name = "source", length = 30)
    private String source;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

    @Column(name = "payroll_entry_id")
    private String payrollEntryId;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
