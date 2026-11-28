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
 * One engine = one objective ("re-engage dormant learners", "14-day challenge"). Many per
 * institute. The engine's evolving brief lives in engagement_prompt_version; this row holds
 * config + the scheduler driver cursor (next_due_at makes institute selection O(engines)).
 */
@Entity
@Table(name = "engagement_engine")
@Getter
@Setter
public class EngagementEngine {

    @Id
    @Column(length = 255, nullable = false)
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(nullable = false)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String objective;

    /** DRAFT | TEMPLATES_PENDING | DRY_RUN | ACTIVE | PAUSED | ARCHIVED */
    @Column(nullable = false, length = 20)
    private String status = "DRAFT";

    /** en | hi | hinglish (hinglish is authored under Meta language code en) */
    @Column(nullable = false, length = 10)
    private String language = "en";

    /** JSON array of selected data-point keys, e.g. ["crm_lead","enrollment"]. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "data_points", columnDefinition = "jsonb", nullable = false)
    private String dataPoints = "[]";

    /** {WHATSAPP:{enabled,auto,autoReply},EMAIL:{enabled,auto,emailType},IN_APP:{...},AI_CALL:{...}} */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String channels = "{}";

    /** [{type:"PACKAGE_SESSION"|"AUDIENCE"|"USER", id:"..."}] */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String audience = "[]";

    /** {startHour,endHour,timezone} — may tighten the institute floor, never loosen. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "quiet_hours", columnDefinition = "jsonb", nullable = false)
    private String quietHours = "{}";

    /** JSON array of staff user ids alerted (bell + email) when the engine needs a human. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "notify_user_ids", columnDefinition = "jsonb", nullable = false)
    private String notifyUserIds = "[]";

    @Column(name = "cadence_hours", nullable = false)
    private Integer cadenceHours = 72;

    /** Phase 2 kill switch: true = never auto-send (drops to copilot tasks); the engine keeps deciding. */
    @Column(name = "auto_send_killed", nullable = false)
    private Boolean autoSendKilled = false;

    /** Graduation ramp override: N human-approved sends before autonomous; NULL = global default. */
    @Column(name = "first_n")
    private Integer firstN;

    /** Holdout %: 0..100 of the audience enrolled but never messaged (for lift measurement). */
    @Column(name = "holdout_pct", nullable = false)
    private Integer holdoutPct = 0;

    @Column(name = "next_due_at")
    private Instant nextDueAt;

    @Column(name = "last_swept_at")
    private Instant lastSweptAt;

    @Column(name = "created_by")
    private String createdBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    /** created_by of the per-institute engine that AI calling owns (AiCallEngagementProvisioner). */
    public static final String CREATED_BY_SYSTEM_AI_CALL = "SYSTEM_AI_CALL";

    /**
     * An engine the platform runs rather than an admin: today only "AI Call Actions", the vehicle
     * for what AI agents promise on calls. Pausing, archiving or re-prompting it would silently
     * stop every one of those sends, so admin changes to it are refused (EngagementEngineService).
     */
    public boolean isSystemManaged() {
        return CREATED_BY_SYSTEM_AI_CALL.equals(createdBy);
    }
}
