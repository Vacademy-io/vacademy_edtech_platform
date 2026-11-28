package vacademy.io.admin_core_service.features.admission_package.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** One course of an {@link AdmissionPackage}: its user plan and its share of the fee and discount. */
@Entity
@Table(name = "admission_package_course")
@Getter
@Setter
@NoArgsConstructor
public class AdmissionPackageCourse {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "admission_package_id", nullable = false)
    private String admissionPackageId;

    @Column(name = "user_plan_id", nullable = false)
    private String userPlanId;

    @Column(name = "package_session_id")
    private String packageSessionId;

    @Column(name = "position", nullable = false)
    private Integer position;

    @Column(name = "fee", nullable = false)
    private BigDecimal fee;

    @Column(name = "discount", nullable = false)
    private BigDecimal discount;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void onCreate() {
        if (id == null) id = java.util.UUID.randomUUID().toString();
        createdAt = LocalDateTime.now();
    }
}
