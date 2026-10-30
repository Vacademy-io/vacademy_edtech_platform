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

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Decision = ledger = task = audit: ONE row. The id doubles as
 * notification_log.correlation_id (stamped as options.sourceId on dispatch), so
 * "did THIS decision land / get read?" is an exact join on the notification ledger.
 *
 * Phase 1a writes kind=TASK|NO_OP only (the copilot phase: engine drafts, human sends).
 * The dispatcher claim (PENDING→DISPATCHING, Phase 1b/2) is the at-most-once mechanism —
 * see design doc §6.3 for why there is deliberately no unique index on the log side.
 */
@Entity
@Table(name = "engagement_action")
@Getter
@Setter
public class EngagementAction {

    @Id
    @Column(length = 255, nullable = false)
    @UuidGenerator
    private String id;

    @Column(name = "engine_id", nullable = false)
    private String engineId;

    @Column(name = "member_id", nullable = false)
    private String memberId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "prompt_version_id")
    private String promptVersionId;

    /** SEND | TASK | REPLY | NO_OP */
    @Column(nullable = false, length = 20)
    private String kind;

    /** SEND_MESSAGE | SHARE_LINK | CALL | BOOK_MEETING | UPDATE_CRM */
    @Column(name = "action_type", length = 30)
    private String actionType;

    /** WHATSAPP | EMAIL | IN_APP | AI_CALL */
    @Column(length = 20)
    private String channel;

    /** PENDING|DISPATCHING|SENT|FAILED|UNKNOWN|SIMULATED | OPEN|ACKED|DONE|DISMISSED|EXPIRED */
    @Column(nullable = false, length = 20)
    private String status;

    @Column(name = "assigned_to")
    private String assignedTo;

    @Column(name = "template_name")
    private String templateName;

    /** Meta language code the template is registered under (en|hi); Meta identifies a template by name+language. */
    @Column(name = "template_language", length = 10)
    private String templateLanguage;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "variables_json", columnDefinition = "jsonb")
    private String variablesJson;

    @Column(name = "draft_body", columnDefinition = "TEXT")
    private String draftBody;

    /** What actually went out — differs from draft_body when the human edited (the EDITED label). */
    @Column(name = "sent_body", columnDefinition = "TEXT")
    private String sentBody;

    /** "Why did it decide this?" — rendered in the inbox and the lead timeline. The trust surface. */
    @Column(columnDefinition = "TEXT")
    private String rationale;

    @Column(precision = 5, scale = 2)
    private BigDecimal priority;

    @Column(name = "scheduled_for")
    private Instant scheduledFor;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "dispatched_at")
    private Instant dispatchedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    /** ACCEPTED | EDITED | DISMISSED | ESCALATED — the labels autotune learns from. */
    @Column(length = 30)
    private String outcome;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    /** Phase 2: set when the per-message credit charge succeeded; NULL on a SENT auto-send = re-bill. */
    @Column(name = "credits_billed_at")
    private Instant creditsBilledAt;

    @Column(name = "llm_tokens_in")
    private Integer llmTokensIn;

    @Column(name = "llm_tokens_out")
    private Integer llmTokensOut;

    /** V631: the model that answered the brain call, and the USD price of its tokens at decision time. */
    @Column(name = "llm_model", length = 255)
    private String llmModel;

    @Column(name = "llm_cost_usd", precision = 14, scale = 8)
    private BigDecimal llmCostUsd;

    /** {@link #source} of a row an AI voice call produced (AiCallActionService). */
    public static final String SOURCE_AI_CALL = "AI_CALL";

    /**
     * Who created this row. NULL for everything the engine itself decided (every row that
     * existed before V462); AI_CALL for a row an AI voice call produced.
     */
    @Column(length = 30)
    private String source;

    /**
     * Natural key of the thing that caused it, callLogId:ruleId for an AI call. Under a
     * partial unique index (V462) this is THE idempotency guard: a re-delivered webhook, a
     * replayed spooled report or a reprocessed outcome must never send the brochure twice.
     */
    @Column(name = "source_ref")
    private String sourceRef;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
}
