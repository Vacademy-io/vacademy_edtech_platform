package vacademy.io.admin_core_service.features.hr_leave.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "hr_leave_balance")
public class LeaveBalance {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "employee_id", nullable = false)
    private EmployeeProfile employee;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "leave_type_id", nullable = false)
    private LeaveType leaveType;

    @Column(name = "year", nullable = false)
    private Integer year;

    @Column(name = "opening_balance", precision = 5, scale = 1)
    private BigDecimal openingBalance;

    @Column(name = "accrued", precision = 5, scale = 1)
    private BigDecimal accrued;

    @Column(name = "used", precision = 5, scale = 1)
    private BigDecimal used;

    @Column(name = "adjustment", precision = 5, scale = 1)
    private BigDecimal adjustment;

    @Column(name = "carried_forward", precision = 5, scale = 1)
    private BigDecimal carriedForward;

    @Column(name = "encashed", precision = 5, scale = 1)
    private BigDecimal encashed;

    @Version
    @Column(name = "version")
    private Long version;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = java.time.LocalDateTime.now();
    }

    public BigDecimal getClosingBalance() {
        BigDecimal ob = openingBalance != null ? openingBalance : BigDecimal.ZERO;
        BigDecimal ac = accrued != null ? accrued : BigDecimal.ZERO;
        BigDecimal cf = carriedForward != null ? carriedForward : BigDecimal.ZERO;
        BigDecimal adj = adjustment != null ? adjustment : BigDecimal.ZERO;
        BigDecimal u = used != null ? used : BigDecimal.ZERO;
        BigDecimal enc = encashed != null ? encashed : BigDecimal.ZERO;
        return ob.add(ac).add(cf).add(adj).subtract(u).subtract(enc);
    }
}
