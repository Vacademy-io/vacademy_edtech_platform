package vacademy.io.admin_core_service.features.admission_package.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * Courses a learner was enrolled in together, with one schedule and one discount (V601). Each
 * course keeps its own user plan and fee bills; see {@link AdmissionPackageCourse}.
 */
@Entity
@Table(name = "admission_package")
@Getter
@Setter
@NoArgsConstructor
public class AdmissionPackage {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "fee_total", nullable = false)
    private BigDecimal feeTotal;

    @Column(name = "discount_total", nullable = false)
    private BigDecimal discountTotal;

    @Column(name = "net_total", nullable = false)
    private BigDecimal netTotal;

    @Column(name = "discount_reason", columnDefinition = "TEXT")
    private String discountReason;

    @Column(name = "schedule_json", columnDefinition = "TEXT")
    private String scheduleJson;

    @Column(name = "created_by_user_id")
    private String createdByUserId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        if (id == null) id = java.util.UUID.randomUUID().toString();
        createdAt = LocalDateTime.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
