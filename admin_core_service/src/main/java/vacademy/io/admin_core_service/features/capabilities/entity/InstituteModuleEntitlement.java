package vacademy.io.admin_core_service.features.capabilities.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * One module or feature switch for an institute (spec §5). {@code key} is a module key or a
 * feature key from capabilities/catalog.json. Written by platform staff only.
 */
@Entity
@Table(name = "institute_module_entitlement")
@IdClass(InstituteModuleEntitlementId.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InstituteModuleEntitlement {

    @Id
    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Id
    @Column(name = "key", nullable = false, length = 128)
    private String key;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    /** NULL = no expiry. At or after this instant the row counts as disabled. */
    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "note", columnDefinition = "TEXT")
    private String note;

    @Column(name = "updated_by")
    private String updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Enabled and not past its expiry. */
    public boolean isActiveAt(Instant now) {
        return enabled && (expiresAt == null || now.isBefore(expiresAt));
    }
}
