package vacademy.io.community_service.feature.webinar.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.util.Date;

/**
 * A webinar published by the super admin from the health-check dashboard and shown in the admin
 * dashboard's Assist Dock "Webinars" panel. Upcoming / live / past is not stored: clients derive
 * it from {@code startsAt} and {@code endsAt}.
 *
 * <p>The table is created by Flyway in assessment_service — community_service shares that
 * database and does no ddl-auto of its own. See
 * {@code assessment_service/src/main/resources/db/migration/V80__create_webinar_table.sql}.
 */
@Entity
@Table(name = "webinar", schema = "public")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(of = "id")
public class Webinar {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "title", length = 500, nullable = false)
    private String title;

    @Column(name = "description", columnDefinition = "text")
    private String description;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    /** The panel shows the webinar as live from startsAt until this. */
    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;

    /** Public join link (Zoom / Meet / registration page); null until it exists. */
    @Column(name = "join_url", length = 2048)
    private String joinUrl;

    /** The recording, once added: public URL of an uploaded file or any video link. */
    @Column(name = "recording_url", length = 2048)
    private String recordingUrl;

    /** media-service file id of the recording, when it was uploaded through the platform. */
    @Column(name = "recording_file_id")
    private String recordingFileId;

    /**
     * The webinar's live class: a session_schedules id in the institute that runs the webinars.
     * Admins of PROD institutes join it in one click from their dashboard.
     */
    @Column(name = "live_schedule_id")
    private String liveScheduleId;

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
