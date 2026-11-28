package vacademy.io.admin_core_service.features.call_intelligence.persistence.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.Map;

/**
 * One row per analyzed call — the provider-agnostic intelligence layer over
 * telephony_call_log (1:1, keyed by {@code call_log_id}). The row also IS the
 * work item: a scheduled poller drains {@code status='PENDING'} rows, transcribes
 * (render worker, Hindi+English) and analyzes (LLM) the recording, then writes
 * the extracted data points back here. We use this DB-backed queue rather than
 * the in-JVM event bus because that bus silently drops events across replicas.
 *
 * Gated per institute by CRM_INTELLIGENCE_SETTING. A handful of dashboard
 * dimensions (institute/counsellor/source/direction/started_at/duration) are
 * denormalized from the call log so per-counsellor / per-team / per-lead
 * roll-ups never join the large call-log table; the full nested analysis lives
 * in {@code analysisJson}. See V345__call_intelligence.sql.
 */
@Entity
@Table(name = "call_intelligence")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CallIntelligence {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true, updatable = false)
    private String id;

    /** 1:1 with the universal call record (telephony_call_log.id). */
    @Column(name = "call_log_id", nullable = false, length = 36)
    private String callLogId;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    // --- Denormalized dashboard dimensions (from telephony_call_log) ---------

    @Column(name = "counsellor_user_id", length = 36)
    private String counsellorUserId;

    @Column(name = "response_id", length = 36)
    private String responseId;

    @Column(name = "user_id", length = 36)
    private String userId;

    /** MANUAL | TELEPHONY | AI — bucketed from the call's provider_type. */
    @Column(name = "source", length = 16)
    private String source;

    /** OUTBOUND | INBOUND. */
    @Column(name = "direction", length = 16)
    private String direction;

    @Column(name = "call_started_at")
    private Timestamp callStartedAt;

    @Column(name = "duration_seconds")
    private Integer durationSeconds;

    // --- Pipeline / queue state ----------------------------------------------

    /** PENDING → TRANSCRIBING → ANALYZING → COMPLETED; FAILED (retryable) / SKIPPED (terminal). */
    @Column(name = "status", nullable = false, length = 24)
    @Builder.Default
    private String status = "PENDING";

    /** Why a row was SKIPPED — INSUFFICIENT_CREDITS, NO_RECORDING, TOO_SHORT, … (surfaced in UI). */
    @Column(name = "skip_reason", length = 48)
    private String skipReason;

    /** ai_service / render-worker job id (idempotent callback correlation). */
    @Column(name = "job_id", length = 64)
    private String jobId;

    @Column(name = "attempts", nullable = false)
    @Builder.Default
    private Integer attempts = 0;

    @Column(name = "error", columnDefinition = "TEXT")
    private String error;

    // --- Transcript artifacts -------------------------------------------------

    /** S3 key of the transcript in the spoken language (hi/en/mixed). */
    @Column(name = "source_text_key", length = 512)
    private String sourceTextKey;

    /** S3 key of the English translation pass (task='both'). */
    @Column(name = "english_text_key", length = 512)
    private String englishTextKey;

    @Column(name = "detected_language", length = 16)
    private String detectedLanguage;

    @Column(name = "language_probability")
    private BigDecimal languageProbability;

    // --- First-class extracted data points (filtered/aggregated) -------------

    @Column(name = "inferred_goal", columnDefinition = "TEXT")
    private String inferredGoal;

    @Column(name = "call_type", length = 32)
    private String callType;

    @Column(name = "general_summary", columnDefinition = "TEXT")
    private String generalSummary;

    /** Two-line "what happened / what's next" for the call log row (V506, schema 1.1). */
    @Column(name = "short_update", length = 200)
    private String shortUpdate;

    @Column(name = "generic_status", length = 32)
    private String genericStatus;

    /** 0-10: how well the caller advanced their own objective. */
    @Column(name = "caller_self_goal_rating")
    private BigDecimal callerSelfGoalRating;

    /** 0-10: outcome strength from the lead's perspective. */
    @Column(name = "call_output_rating")
    private BigDecimal callOutputRating;

    @Column(name = "conversion_likelihood", length = 8)
    private String conversionLikelihood;

    @Column(name = "lead_sentiment", length = 12)
    private String leadSentiment;

    /** Full nested analysis: action_items, call_analysis, rating qualities, coaching_tips, talk_ratio, highlights. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "analysis_json", columnDefinition = "jsonb")
    private Map<String, Object> analysisJson;

    @Column(name = "schema_version", length = 8)
    private String schemaVersion;

    // --- Credit accounting ----------------------------------------------------

    @Column(name = "credits_charged")
    private BigDecimal creditsCharged;

    /** Links to ai_token_usage.id (the deduction's usage log). */
    @Column(name = "usage_log_id", length = 36)
    private String usageLogId;

    // --- Model audit ----------------------------------------------------------

    @Column(name = "model", length = 100)
    private String model;

    @Column(name = "prompt_version", length = 16)
    private String promptVersion;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    @Column(name = "completed_at")
    private Timestamp completedAt;
}
