package vacademy.io.admin_core_service.features.commerce.accounts.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/**
 * A supplier's PAN, encrypted by the commerce field cipher (V743). One row per supplier. Loaded only
 * to show the value to an authorised user; lists read {@code pan_last4} through a projection.
 * {@code toString} prints no field.
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(onlyExplicitlyIncluded = true)
@Entity
@Table(name = "commerce_supplier_secret")
public class CommerceSupplierSecret {

    @Id
    @UuidGenerator
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "supplier_id", nullable = false, updatable = false, length = 36)
    private String supplierId;

    /** {@code cfc1:<key id>:...}; never logged, never returned. */
    @Column(name = "pan_encrypted", nullable = false, columnDefinition = "TEXT")
    private String panEncrypted;

    @Column(name = "key_id", nullable = false, length = 16)
    private String keyId;

    /** Keyed hash, to find suppliers with the same PAN without decrypting. */
    @Column(name = "pan_hash", nullable = false, length = 64)
    private String panHash;

    @Column(name = "pan_last4", nullable = false, length = 4)
    private String panLast4;

    @Column(name = "updated_by", length = 36)
    private String updatedBy;

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
