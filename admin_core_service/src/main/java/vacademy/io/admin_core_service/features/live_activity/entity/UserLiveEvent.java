package vacademy.io.admin_core_service.features.live_activity.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.sql.Timestamp;

/**
 * One row per real-world moment in the live activity feed.
 *
 * <p>Written only through {@code LiveActivityRecorder}, never directly -- it owns the
 * ON CONFLICT DO NOTHING insert and the fan-out that follows it.
 */
@Entity
@Table(name = "user_live_event")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserLiveEvent {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "occurred_at", nullable = false)
    private Timestamp occurredAt;

    @Column(name = "category", nullable = false)
    private String category;

    @Column(name = "action", nullable = false)
    private String action;

    @Column(name = "actor_type", nullable = false)
    private String actorType;

    /**
     * Deterministic idempotency key. Derived from the business fact only -- never from a
     * timestamp or a generated id, or it stops colliding and silently disables the unique
     * index that is the whole defence against duplicate events.
     */
    @Column(name = "dedupe_key", nullable = false, unique = true)
    private String dedupeKey;

    @Column(name = "subject_name")
    private String subjectName;

    @Column(name = "subject_email")
    private String subjectEmail;

    @Column(name = "subject_mobile")
    private String subjectMobile;

    @Column(name = "subject_id")
    private String subjectId;

    @Column(name = "entity_id")
    private String entityId;

    /**
     * Resolved counsellor. Note the reconciliation trap: a lead carries
     * {@code user_lead_profile.assigned_counselor_id} while a call carries
     * {@code telephony_call_log.counsellor_user_id}. Producers must populate this with the
     * same COALESCE'd value the reporting queries use, not whichever one is nearest to hand.
     */
    @Column(name = "counsellor_user_id")
    private String counsellorUserId;

    @Column(name = "counsellor_name")
    private String counsellorName;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload", columnDefinition = "jsonb")
    private String payload;
}
