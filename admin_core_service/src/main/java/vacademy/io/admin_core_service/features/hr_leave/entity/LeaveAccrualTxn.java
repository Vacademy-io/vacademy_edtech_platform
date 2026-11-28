package vacademy.io.admin_core_service.features.hr_leave.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * Ledger of leave accrual events. One row per (employee, leave type, period)
 * — the unique constraint on (employee_id, leave_type_id, period_key) makes
 * every accrual, pro-rata grant and carry-forward idempotent.
 *
 * period_key formats: MONTHLY "YYYY-MM", QUARTERLY "YYYY-Qn", YEARLY "YYYY",
 * year-end carry-forward marker "CARRY-YYYY".
 */
@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "hr_leave_accrual_txn")
public class LeaveAccrualTxn {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "employee_id", nullable = false)
    private String employeeId;

    @Column(name = "leave_type_id", nullable = false)
    private String leaveTypeId;

    @Column(name = "policy_id")
    private String policyId;

    @Column(name = "year", nullable = false)
    private Integer year;

    @Column(name = "period_key", nullable = false, length = 20)
    private String periodKey;

    @Column(name = "amount", precision = 5, scale = 2)
    private BigDecimal amount;

    @Column(name = "source", length = 30)
    private String source;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
