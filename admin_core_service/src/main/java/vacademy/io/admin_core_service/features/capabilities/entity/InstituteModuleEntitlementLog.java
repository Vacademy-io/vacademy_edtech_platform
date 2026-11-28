package vacademy.io.admin_core_service.features.capabilities.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * One change of an entitlement row, or of the mode (key {@link #MODE_KEY}; enabled = MANAGED).
 * old_enabled NULL = the row did not exist before.
 */
@Entity
@Table(name = "institute_module_entitlement_log")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InstituteModuleEntitlementLog {

    public static final String MODE_KEY = "_mode";

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "key", nullable = false, length = 128)
    private String key;

    @Column(name = "old_enabled")
    private Boolean oldEnabled;

    @Column(name = "new_enabled")
    private Boolean newEnabled;

    @Column(name = "old_expires_at")
    private Instant oldExpiresAt;

    @Column(name = "new_expires_at")
    private Instant newExpiresAt;

    @Column(name = "old_note", columnDefinition = "TEXT")
    private String oldNote;

    @Column(name = "new_note", columnDefinition = "TEXT")
    private String newNote;

    @Column(name = "reason", nullable = false, columnDefinition = "TEXT")
    private String reason;

    @Column(name = "actor")
    private String actor;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
