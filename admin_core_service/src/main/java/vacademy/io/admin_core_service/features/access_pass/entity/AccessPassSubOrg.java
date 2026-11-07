package vacademy.io.admin_core_service.features.access_pass.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/** B2B: a sub-org holding a pass. The sync pushes the pass's courses to every ACTIVE link. */
@Entity
@Table(name = "access_pass_sub_org")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AccessPassSubOrg {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "access_pass_id", nullable = false, length = 36)
    private String accessPassId;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    @Column(name = "sub_org_id", nullable = false)
    private String subOrgId;

    /** ACTIVE | REMOVED. */
    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "assigned_by")
    private String assignedBy;

    @Column(name = "removed_by")
    private String removedBy;

    @Column(name = "assigned_at")
    private Timestamp assignedAt;

    @Column(name = "removed_at")
    private Timestamp removedAt;

    @Column(name = "last_synced_at")
    private Timestamp lastSyncedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Timestamp createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
