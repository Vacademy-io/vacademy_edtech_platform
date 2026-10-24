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

/** One course (package session) a pass includes. The source of truth for the pass invite's mappings. */
@Entity
@Table(name = "access_pass_item")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AccessPassItem {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "access_pass_id", nullable = false, length = 36)
    private String accessPassId;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    @Column(name = "package_session_id", nullable = false)
    private String packageSessionId;

    /** ACTIVE | REMOVED. */
    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "display_order", nullable = false)
    private Integer displayOrder;

    @Column(name = "added_by")
    private String addedBy;

    @Column(name = "removed_by")
    private String removedBy;

    @Column(name = "added_at")
    private Timestamp addedAt;

    @Column(name = "removed_at")
    private Timestamp removedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Timestamp createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
