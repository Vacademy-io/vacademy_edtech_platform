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

/**
 * One purchasable product that unlocks a set of courses. Owns a system-managed
 * enroll_invite (tag ACCESS_PASS) that checkout runs on. See V595__access_pass.sql and
 * docs/accesspass/ACCESS_PASS_IMPLEMENTATION.md.
 */
@Entity
@Table(name = "access_pass")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AccessPass {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "slug", nullable = false)
    private String slug;

    @Column(name = "short_description", columnDefinition = "TEXT")
    private String shortDescription;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "cover_image_url", columnDefinition = "TEXT")
    private String coverImageUrl;

    /** Comma-separated, same convention as package.comma_separated_tags. */
    @Column(name = "tags", columnDefinition = "TEXT")
    private String tags;

    /** {@link vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.AccessPassStatus}. */
    @Column(name = "status", nullable = false, length = 32)
    private String status;

    /** {@link vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.AudienceType}. */
    @Column(name = "audience_type", nullable = false, length = 16)
    private String audienceType;

    /** {@link vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.CourseScope}. */
    @Column(name = "course_scope", nullable = false, length = 32)
    private String courseScope;

    @Column(name = "payment_option_id")
    private String paymentOptionId;

    @Column(name = "enroll_invite_id")
    private String enrollInviteId;

    /** {@link vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.ItemRemovalPolicy}. */
    @Column(name = "on_item_removed", nullable = false, length = 32)
    private String onItemRemoved;

    @Column(name = "display_order", nullable = false)
    private Integer displayOrder;

    @Column(name = "settings_json", columnDefinition = "TEXT")
    private String settingsJson;

    @Column(name = "needs_sync", nullable = false)
    private Boolean needsSync;

    @Column(name = "last_synced_at")
    private Timestamp lastSyncedAt;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "updated_by")
    private String updatedBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Timestamp createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
