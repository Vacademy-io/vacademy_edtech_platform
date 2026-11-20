package vacademy.io.admin_core_service.features.commerce.security.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/**
 * Whether a manager or accountant acts for every location of the institute (V734). One row per
 * institute and user; written by the native upsert of {@code CommerceStaffScopeRepository}. A row on
 * a warehouse or counter role has no effect.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_staff_scope")
public class CommerceStaffScope {

    @Id
    @UuidGenerator
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "user_id", nullable = false, updatable = false, length = 36)
    private String userId;

    @Column(name = "all_locations", nullable = false)
    private boolean allLocations;

    @Column(name = "set_by", length = 36)
    private String setBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    // The database default covers the insert only and no trigger maintains the column.
    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    void touchUpdatedAt() {
        this.updatedAt = LocalDateTime.now();
    }
}
