package vacademy.io.admin_core_service.features.hr_payroll.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "hr_payroll_run")
public class PayrollRun {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "month", nullable = false)
    private Integer month;

    @Column(name = "year", nullable = false)
    private Integer year;

    @Column(name = "run_date")
    private LocalDate runDate;

    @Column(name = "status", length = 20)
    private String status;

    // REGULAR | OFF_CYCLE | FNF | BONUS (V480; only REGULAR runs are unique per month)
    @Column(name = "run_type", length = 30)
    private String runType;

    @Version
    @Column(name = "version")
    private Long version;

    @Column(name = "total_employees")
    private Integer totalEmployees;

    @Column(name = "total_gross", precision = 18, scale = 2)
    private BigDecimal totalGross;

    @Column(name = "total_deductions", precision = 18, scale = 2)
    private BigDecimal totalDeductions;

    @Column(name = "total_net_pay", precision = 18, scale = 2)
    private BigDecimal totalNetPay;

    @Column(name = "total_employer_cost", precision = 18, scale = 2)
    private BigDecimal totalEmployerCost;

    @Column(name = "processed_by")
    private String processedBy;

    @Column(name = "processed_at")
    private LocalDateTime processedAt;

    @Column(name = "approved_by")
    private String approvedBy;

    @Column(name = "approved_at")
    private LocalDateTime approvedAt;

    @Column(name = "paid_at")
    private LocalDateTime paidAt;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

    @Column(name = "currency", length = 3)
    private String currency;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = java.time.LocalDateTime.now();
    }
}
