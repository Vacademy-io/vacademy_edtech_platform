package vacademy.io.admin_core_service.features.hr_payroll.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeBankDetail;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryStructure;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "hr_payroll_entry")
public class PayrollEntry {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "payroll_run_id", nullable = false)
    private PayrollRun payrollRun;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "employee_id", nullable = false)
    private EmployeeProfile employee;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "salary_structure_id")
    private EmployeeSalaryStructure salaryStructure;

    @Column(name = "gross_salary", nullable = false, precision = 15, scale = 2)
    private BigDecimal grossSalary;

    @Column(name = "total_earnings", precision = 15, scale = 2)
    private BigDecimal totalEarnings;

    @Column(name = "total_deductions", precision = 15, scale = 2)
    private BigDecimal totalDeductions;

    @Column(name = "total_employer_contributions", precision = 15, scale = 2)
    private BigDecimal totalEmployerContributions;

    @Column(name = "net_pay", nullable = false, precision = 15, scale = 2)
    private BigDecimal netPay;

    @Column(name = "total_working_days")
    private Integer totalWorkingDays;

    @Column(name = "days_present", precision = 5, scale = 1)
    private BigDecimal daysPresent;

    @Column(name = "days_absent", precision = 5, scale = 1)
    private BigDecimal daysAbsent;

    @Column(name = "days_on_leave", precision = 5, scale = 1)
    private BigDecimal daysOnLeave;

    @Column(name = "days_holiday")
    private Integer daysHoliday;

    @Column(name = "overtime_hours", precision = 5, scale = 2)
    private BigDecimal overtimeHours;

    @Column(name = "arrears", precision = 15, scale = 2)
    private BigDecimal arrears;

    @Column(name = "reimbursements", precision = 15, scale = 2)
    private BigDecimal reimbursements;

    @Column(name = "loan_deduction", precision = 15, scale = 2)
    private BigDecimal loanDeduction;

    @Column(name = "other_earnings", precision = 15, scale = 2)
    private BigDecimal otherEarnings;

    @Column(name = "other_deductions", precision = 15, scale = 2)
    private BigDecimal otherDeductions;

    @Column(name = "status", length = 20)
    private String status;

    @Column(name = "hold_reason", columnDefinition = "TEXT")
    private String holdReason;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "bank_account_id")
    private EmployeeBankDetail bankAccount;

    @Column(name = "payment_ref")
    private String paymentRef;

    @OneToMany(mappedBy = "payrollEntry", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<PayrollEntryComponent> entryComponents;

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
