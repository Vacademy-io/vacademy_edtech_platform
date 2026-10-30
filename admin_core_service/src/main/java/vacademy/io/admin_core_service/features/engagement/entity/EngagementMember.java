package vacademy.io.admin_core_service.features.engagement.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * One enrolled subject per engine. Subject identity is user_id (learner/converted lead) OR
 * audience_response_id (unconverted lead) — enforced by ck_em_subject + the COALESCE unique
 * index ux_em_subject (Postgres NULLs are distinct; without COALESCE the same lead could
 * enrol N times). A member is invisible to the sweep until next_action_at comes due — this is
 * why cost scales with decisions, not enrolled users.
 */
@Entity
@Table(name = "engagement_member")
@Getter
@Setter
public class EngagementMember {

    @Id
    @Column(length = 255, nullable = false)
    @UuidGenerator
    private String id;

    @Column(name = "engine_id", nullable = false)
    private String engineId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "audience_response_id")
    private String audienceResponseId;

    /** ACTIVE | PAUSED | EXITED | OPTED_OUT */
    @Column(nullable = false, length = 20)
    private String status = "ACTIVE";

    /** 0 HOT .. 3 DORMANT — events (replies) promote to 0; no-ops decay downward. */
    @Column(nullable = false)
    private Short tier = 2;

    /**
     * The scheduler key AND the claim lease: claimDueMembers pushes this +15min under
     * FOR UPDATE SKIP LOCKED (never a status flip — a status flip is a terminal state on
     * pod death; a lease just comes due again).
     */
    @Column(name = "next_action_at", nullable = false)
    private Instant nextActionAt;

    @Column(name = "last_decided_at")
    private Instant lastDecidedAt;

    @Column(name = "consecutive_no_ops", nullable = false)
    private Short consecutiveNoOps = 0;

    /** Separate from no-ops: transient call failures back off THIS, never the cadence counter. */
    @Column(name = "consecutive_failures", nullable = false)
    private Short consecutiveFailures = 0;

    /** Hash of QUANTIZED features (bands, never raw values — raw values change every tick for active users). */
    @Column(name = "wake_fingerprint", length = 64)
    private String wakeFingerprint;

    /** WhatsApp 24h free-form reply window (stamped by reply ingestion in 1b). */
    @Column(name = "window_open_until")
    private Instant windowOpenUntil;

    /** Last inbound wamid the auto-reply has handled — the at-most-once dedup key for answering replies. */
    @Column(name = "last_reply_wamid", length = 255)
    private String lastReplyWamid;

    /** Holdout cohort (Phase 2): enrolled but never messaged, for lift measurement. Set once at enroll. */
    @Column(name = "is_holdout", nullable = false)
    private Boolean isHoldout = false;

    /**
     * B4 wake stamps — read-only here: only the targeted UPDATEs in EngagementMemberRepository
     * write them, so a save() of a member read before a wake landed cannot undo the wake.
     */
    @Column(name = "woken_at", insertable = false, updatable = false)
    private Instant wokenAt;

    @Column(name = "wake_reason", length = 40, insertable = false, updatable = false)
    private String wakeReason;

    @Column(name = "human_touch_at", insertable = false, updatable = false)
    private Instant humanTouchAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "memory_json", columnDefinition = "jsonb", nullable = false)
    private String memoryJson = "{}";

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
}
