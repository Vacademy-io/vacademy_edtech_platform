package vacademy.io.community_service.feature.trainingvideo.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
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
 *
 * <p>Since V80 the same table also holds the Assist Dock "Webinars" ({@link #KIND_WEBINAR}):
 * those rows use {@code startsAt}/{@code endsAt}/{@code joinUrl}, and {@code fileUrl} is their
 * recording (null until one is added). See feature/webinar.
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

    /** A training video in the Training popup — every row created before V80. */
    public static final String KIND_TRAINING = "TRAINING";
    /** A live webinar in the Webinars panel. */
    public static final String KIND_WEBINAR = "WEBINAR";

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

    /**
     * Public S3 URL the admin popup streams the video from. Always set for a training video;
     * a webinar's recording, so null until the recording is added (nullable since V80).
     */
    @Column(name = "file_url", length = 2048)
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

    /** {@link #KIND_TRAINING} or {@link #KIND_WEBINAR}. See V80. */
    @Column(name = "kind", length = 32, nullable = false)
    @Builder.Default
    private String kind = KIND_TRAINING;

    /** Webinars only: when it starts. */
    @Column(name = "starts_at")
    private Instant startsAt;

    /** Webinars only: when it ends. The Webinars panel shows it as live between the two. */
    @Column(name = "ends_at")
    private Instant endsAt;

    /** Webinars only: the link admins open to join. */
    @Column(name = "join_url", length = 2048)
    private String joinUrl;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
