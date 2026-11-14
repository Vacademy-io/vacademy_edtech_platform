package vacademy.io.admin_core_service.features.hr_salary.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "hr_employee_salary_structure")
public class EmployeeSalaryStructure {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "employee_id", nullable = false)
    private EmployeeProfile employee;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "template_id")
    private SalaryTemplate template;

    @Column(name = "effective_from", nullable = false)
    private LocalDate effectiveFrom;

    @Column(name = "effective_to")
    private LocalDate effectiveTo;

    @Column(name = "ctc_annual", nullable = false, precision = 15, scale = 2)
    private BigDecimal ctcAnnual;

    @Column(name = "ctc_monthly", precision = 15, scale = 2)
    private BigDecimal ctcMonthly;

    @Column(name = "gross_monthly", precision = 15, scale = 2)
    private BigDecimal grossMonthly;

    @Column(name = "net_monthly", precision = 15, scale = 2)
    private BigDecimal netMonthly;

    @Column(name = "status", length = 20)
    private String status;

    @Column(name = "revision_reason", columnDefinition = "TEXT")
    private String revisionReason;

    @Column(name = "approved_by")
    private String approvedBy;

    @Column(name = "approved_at")
    private LocalDateTime approvedAt;

    @OneToMany(mappedBy = "salaryStructure", fetch = FetchType.LAZY)
    private List<EmployeeSalaryComponent> components;

    @Version
    @Column(name = "version")
    private Long version;

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
