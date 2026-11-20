package vacademy.io.admin_core_service.features.commerce.accounts.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Immutable;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * The date through which an institute's books are closed (V734); null = nothing closed. One row per
 * institute, created on first need. Read-only through JPA: the row is created and changed only by
 * the native statements of {@code CommercePeriodLockRepository}, which read it under row locks.
 */
@Getter
@Setter
@NoArgsConstructor
@Immutable
@Entity
@Table(name = "commerce_period_lock")
public class CommercePeriodLock {

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "locked_through")
    private LocalDate lockedThrough;

    @Column(name = "locked_by", length = 36)
    private String lockedBy;

    @Column(name = "locked_at")
    private LocalDateTime lockedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;
}
