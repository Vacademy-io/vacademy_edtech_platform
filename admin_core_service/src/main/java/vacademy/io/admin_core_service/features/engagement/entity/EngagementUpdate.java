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
 * Time-boxed news an admin feeds an engine: a festival greeting, an offer. The brain reads the ones
 * live right now as facts it may share, and nothing tied to one goes out after it ends.
 */
@Entity
@Table(name = "engagement_update")
@Getter
@Setter
public class EngagementUpdate {

    public static final String ACTIVE = "ACTIVE";
    public static final String ENDED = "ENDED";

    @Id
    @Column(length = 255, nullable = false)
    @UuidGenerator
    private String id;

    @Column(name = "engine_id", nullable = false)
    private String engineId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String message;

    /** The approved WhatsApp template that carries this update; null = email and other channels only. */
    @Column(name = "template_name")
    private String templateName;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;

    @Column(nullable = false, length = 20)
    private String status = ACTIVE;

    /** When the engine's people were asked to look at it; null until it starts. */
    @Column(name = "announced_at")
    private Instant announcedAt;

    @Column(name = "created_by")
    private String createdBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    public boolean liveAt(Instant now) {
        return ACTIVE.equals(status) && !now.isBefore(startsAt) && now.isBefore(endsAt);
    }
}
