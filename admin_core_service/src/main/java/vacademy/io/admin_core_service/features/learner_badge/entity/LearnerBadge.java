package vacademy.io.admin_core_service.features.learner_badge.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * A badge manually awarded by an admin/institute to a specific learner.
 * Distinct from the auto-unlock badges (which are recomputed on the client) — a
 * manual award is a durable, persisted recognition with an issuer and a reason.
 */
@Entity
@Table(name = "learner_badge")
@Getter
@Setter
@NoArgsConstructor
public class LearnerBadge {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** References a badge configured in the BADGES_REWARDS_SETTING institute setting. */
    @Column(name = "badge_id", nullable = false)
    private String badgeId;

    // Snapshot of the badge presentation at award time (survives later config edits).
    @Column(name = "badge_name")
    private String badgeName;

    @Column(name = "badge_icon")
    private String badgeIcon;

    @Column(name = "badge_description")
    private String badgeDescription;

    @Column(name = "reason")
    private String reason;

    /** MANUAL = admin-awarded; AUTO = synced from the learner app's client-computed unlocks. */
    @Column(name = "source", nullable = false)
    private String source = "MANUAL";

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private LearnerBadgeStatus status = LearnerBadgeStatus.ACTIVE;

    @Column(name = "awarded_by_user_id")
    private String awardedByUserId;

    // Set explicitly at award time so the award() response carries it (the DB
    // default still applies as a fallback). Mutable because a staff award that
    // lands on an existing AUTO row upgrades it in place and re-stamps this.
    @Column(name = "awarded_at")
    private Timestamp awardedAt;

    @Column(name = "revoked_by_user_id")
    private String revokedByUserId;

    @Column(name = "revoked_at")
    private Timestamp revokedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    public boolean isActive() {
        return this.status == LearnerBadgeStatus.ACTIVE;
    }
}
