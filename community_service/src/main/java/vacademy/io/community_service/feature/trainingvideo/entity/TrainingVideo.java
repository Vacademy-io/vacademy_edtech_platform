package vacademy.io.community_service.feature.trainingvideo.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.util.Date;

/**
 * An LMS training video published by the super admin from the health-check dashboard and
 * played in the admin dashboard's Assist Dock "Training" popup.
 *
 * <p>The video bytes live in S3 (uploaded through media-service, PUBLIC visibility); this row
 * only carries the metadata: name, description and the module-level path the super admin
 * placed it under, e.g. ["LMS","Course creation","AI based course"]. The admin popup renders
 * those segments as a collapsible module tree.
 *
 * <p>The table is created by Flyway in assessment_service — community_service shares that
 * database and does no ddl-auto of its own. See
 * {@code assessment_service/src/main/resources/db/migration/V47__create_training_video_table.sql};
 * it runs automatically on every environment when assessment_service deploys.
 */
@Entity
@Table(name = "training_video", schema = "public")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(of = "id")
public class TrainingVideo {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "title", length = 500, nullable = false)
    private String title;

    @Column(name = "description", columnDefinition = "text")
    private String description;

    /** media-service (S3) file id, when the video was uploaded through the platform pipeline. */
    @Column(name = "file_id")
    private String fileId;

    /** Public S3 URL the admin popup streams the video from. */
    @Column(name = "file_url", length = 2048, nullable = false)
    private String fileUrl;

    /** jsonb array of 1..3 breadcrumb segments, e.g. ["LMS","Course creation","AI based course"]. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "module_path", columnDefinition = "jsonb", nullable = false)
    private String modulePath;

    /** jsonb array of extra search words (synonyms, Hinglish, old names) set by the super admin. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "keywords", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private String keywords = "[]";

    /** Step number inside its section (1, 2, 3 ...); null = unordered. See V51. */
    @Column(name = "sort_order")
    private Integer sortOrder;

    @Column(name = "active", nullable = false)
    @Builder.Default
    private boolean active = true;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
