package vacademy.io.admin_core_service.features.commerce.catalogue.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PreUpdate;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/** Columns every catalogue table has. */
@Getter
@Setter
@MappedSuperclass
public abstract class CommerceCatalogueEntity {

    @Id
    @UuidGenerator
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

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
