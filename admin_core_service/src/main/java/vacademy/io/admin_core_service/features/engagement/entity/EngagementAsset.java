package vacademy.io.admin_core_service.features.engagement.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;

/**
 * One piece of marketing material in an engine's assets (brochure, demo video, price sheet…).
 * The reply brain reads title + description to decide what to send; the file goes out as a native
 * WhatsApp attachment fetched by Meta/WATI from {@link #url}, so the URL must be public.
 */
@Entity
@Table(name = "engagement_asset")
@Getter
@Setter
public class EngagementAsset {

    /** Media types a WhatsApp session message can carry, plus a plain link sent inside the text. */
    public static final java.util.Set<String> MEDIA_TYPES =
            java.util.Set.of("document", "image", "video", "audio", "link");

    @Id
    @Column(length = 255, nullable = false)
    @UuidGenerator
    private String id;

    @Column(name = "engine_id", nullable = false)
    private String engineId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(nullable = false, length = 200)
    private String title;

    /** What it is and when to send it. The brain matches a request against this. */
    @Column(columnDefinition = "TEXT")
    private String description;

    /** document | image | video | audio | link */
    @Column(name = "media_type", nullable = false, length = 20)
    private String mediaType;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String url;

    @Column(name = "file_id")
    private String fileId;

    private String filename;

    @Column(name = "mime_type", length = 120)
    private String mimeType;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @Column(name = "created_by")
    private String createdBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
}
