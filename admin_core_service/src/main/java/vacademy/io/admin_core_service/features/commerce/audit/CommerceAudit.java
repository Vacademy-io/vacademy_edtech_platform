package vacademy.io.admin_core_service.features.commerce.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Date;

/** One audit entry (V679). Append-only: never updated, never purged. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_audit")
public class CommerceAudit {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false)
    private String instituteId;

    @Column(name = "actor_user_id", updatable = false)
    private String actorUserId;

    @Column(name = "location_id", updatable = false)
    private String locationId;

    @Column(name = "kind", nullable = false, length = 32, updatable = false)
    private String kind;

    @Column(name = "reference_type", length = 32, updatable = false)
    private String referenceType;

    @Column(name = "reference_id", length = 64, updatable = false)
    private String referenceId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "old_value_json", columnDefinition = "jsonb", updatable = false)
    private String oldValueJson;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "new_value_json", columnDefinition = "jsonb", updatable = false)
    private String newValueJson;

    @Column(name = "reason", columnDefinition = "TEXT", updatable = false)
    private String reason;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
