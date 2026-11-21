package vacademy.io.admin_core_service.features.marketing.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/** A social post written once and published to one or more social accounts (see SocialPostTarget). */
@Entity
@Table(name = "social_post")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SocialPost {

    @Id
    @UuidGenerator
    @Column(length = 255, nullable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "title")
    private String title;

    @Column(name = "body", columnDefinition = "TEXT")
    private String body;

    @Column(name = "link_url", columnDefinition = "TEXT")
    private String linkUrl;

    /** JSON text: [{"file_id":"..","type":"IMAGE|VIDEO","name":".."}] */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "media_json", columnDefinition = "jsonb")
    private String mediaJson;

    /** JSON text: {"INSTAGRAM":"text", "GOOGLE_BUSINESS":"text", ...} */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "overrides_json", columnDefinition = "jsonb")
    private String overridesJson;

    @Column(name = "scheduled_at")
    private Instant scheduledAt;

    /** DRAFT | NEEDS_APPROVAL | SCHEDULED | PUBLISHING | POSTED | PARTIAL | FAILED | CANCELLED */
    @Builder.Default
    @Column(name = "status", nullable = false, length = 32)
    private String status = "DRAFT";

    /** MANUAL | AGENT */
    @Builder.Default
    @Column(name = "source", nullable = false, length = 16)
    private String source = "MANUAL";

    @Column(name = "created_by_user_id")
    private String createdByUserId;

    @Column(name = "approved_by_user_id")
    private String approvedByUserId;

    @Column(name = "approved_at")
    private Instant approvedAt;

    @Column(name = "last_error", columnDefinition = "TEXT")
    private String lastError;

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
