package vacademy.io.admin_core_service.features.telephony.persistence.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;

/**
 * One row per Aavtaar end-of-call webhook delivery — the landing zone.
 *
 * Aavtaar POSTs a single report AFTER each call ends. Unlike Exotel (where we
 * pre-create the telephony_call_log row and the provider posts back against our
 * correlation id), an Aavtaar call — especially inbound — has no pre-existing
 * row, so we create-or-update here keyed by {@code call_uuid}. The raw body is
 * always retained. Later phases promote this into telephony_call_log, bind it to
 * the lead, copy the recording to our S3 (so it shows on the lead profile), and
 * — based on the AI-calling settings — assign a counsellor.
 */
@Entity
@Table(name = "ai_call_result")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AiCallResult {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true, updatable = false)
    private String id;

    @Column(name = "provider", nullable = false, length = 32)
    @Builder.Default
    private String provider = "AAVTAAR";

    /** Aavtaar/Plivo call id; idempotency key for re-POSTs. */
    @Column(name = "call_uuid", length = 64)
    private String callUuid;

    @Column(name = "institute_id", length = 36)
    private String instituteId;

    /** Set when promoted to a telephony_call_log row (later phase). */
    @Column(name = "call_log_id", length = 36)
    private String callLogId;

    /** Set when the call was workflow-driven (outbound) — drives the resume bridge. */
    @Column(name = "workflow_execution_id", length = 36)
    private String workflowExecutionId;

    /** Our reference echoed back in metadata{} on outbound calls. */
    @Column(name = "correlation_id", length = 64)
    private String correlationId;

    @Column(name = "direction", length = 16)
    private String direction;

    @Column(name = "campaign_type", length = 32)
    private String campaignType;

    @Column(name = "campaign_id", length = 64)
    private String campaignId;

    @Column(name = "phone_number", length = 20)
    private String phoneNumber;

    @Column(name = "dial_code", length = 8)
    private String dialCode;

    @Column(name = "call_retry")
    private Integer callRetry;

    @Column(name = "customer_name", length = 255)
    private String customerName;

    @Column(name = "customer_email", length = 255)
    private String customerEmail;

    @Column(name = "status", length = 32)
    private String status;

    @Column(name = "disposition", length = 64)
    private String disposition;

    @Column(name = "lead_response", length = 64)
    private String leadResponse;

    @Column(name = "lead_rating")
    private Integer leadRating;

    @Column(name = "call_rating")
    private Integer callRating;

    @Column(name = "interest_level", length = 64)
    private String interestLevel;

    @Column(name = "ai_summary", columnDefinition = "TEXT")
    private String aiSummary;

    /** Structured Q&A the bot extracted — campaign-specific keys, kept as JSON. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "extracted_qa", columnDefinition = "jsonb")
    private Map<String, Object> extractedQa;

    /** Our metadata bag echoed back (when Aavtaar supports it). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Verbatim per-call technical diagnostics from the end-of-call report (V416) —
     * health verdict, fault codes, TTS/LLM/STT latency, playout + turn-taking truth.
     * Kept whole so a health verdict can be re-derived across history when the bot's
     * rulesVersion changes. Null = the report carried none (NOT "healthy").
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "diagnostics", columnDefinition = "jsonb")
    private Map<String, Object> diagnostics;

    /** GREEN / AMBER / RED, derived from {@link #diagnostics} at ingest. Null = not measured. */
    @Column(name = "diag_health", length = 8)
    private String diagHealth;

    /** Comma-joined fault codes ("DEAD_AIR,TTS_WEDGE") — denormalised so fleet triage is a cheap LIKE. */
    @Column(name = "diag_faults", columnDefinition = "TEXT")
    private String diagFaults;

    /**
     * CALL / CALL_LATER / SKIP — should a human counsellor call this lead next.
     * Exists only to colour {@link #followUpGist} and to filter on; it is never
     * shown as a word on its own. NULL = NOT ASSESSED and must never be read as
     * CALL — same contract as {@code diagHealth}.
     */
    @Column(name = "follow_up", length = 16)
    private String followUp;

    /**
     * ONE sentence for the counsellor deciding whether to pick up the phone for this
     * lead: the recommendation and the concrete reason from the call —
     * "Worth a call — runs a 50-member hybrid studio, asked about pricing." Not a
     * grade of our agent and not the disposition restated; the thing a human reads
     * in the Call Log to decide in one glance. Capped at 240 chars by the bot.
     * NULL = not assessed.
     */
    @Column(name = "follow_up_gist", length = 255)
    private String followUpGist;

    /**
     * Words the caller actually said, measured from the transcript. The outcome
     * classifier routes an engaged-but-unjudged call to a human off this rather than
     * off the disposition string. NULL = not measured (pre-existing rows) and must
     * NOT be read as 0, which is a real silent pickup.
     */
    @Column(name = "caller_word_count")
    private Integer callerWordCount;

    @Column(name = "callback")
    private Boolean callback;

    @Column(name = "callback_at")
    private Instant callbackAt;

    @Column(name = "callback_time_text", length = 128)
    private String callbackTimeText;

    @Column(name = "transfer_call")
    private Boolean transferCall;

    @Column(name = "nine_pressed")
    private Boolean ninePressed;

    @Column(name = "transfer_status", length = 64)
    private String transferStatus;

    @Column(name = "transfer_triggered", length = 64)
    private String transferTriggered;

    @Column(name = "hangup_cause", length = 64)
    private String hangupCause;

    @Column(name = "hangup_code")
    private Integer hangupCode;

    @Column(name = "hangup_source", length = 32)
    private String hangupSource;

    @Column(name = "recording_url", columnDefinition = "TEXT")
    private String recordingUrl;

    @Column(name = "duration_seconds")
    private Integer durationSeconds;

    @Column(name = "call_start")
    private Instant callStart;

    /**
     * When the per-minute credit meter successfully charged this record (V378).
     * Stamped by CallBillingService after ai_service acknowledges the deduction;
     * null = not yet billed (retried by the reconciliation sweep). Makes the charge
     * attempt at-least-once instead of fire-and-forget.
     */
    @Column(name = "credits_billed_at")
    private java.time.Instant creditsBilledAt;

    @Column(name = "transcript", columnDefinition = "TEXT")
    private String transcript;

    /** Entire original POST body — always retained even if parsing partially fails. */
    @Column(name = "raw_payload", columnDefinition = "TEXT", nullable = false)
    private String rawPayload;

    /** RECEIVED → PROCESSED / PARSE_FAILED, for the downstream promoter job. */
    @Column(name = "processing_status", nullable = false, length = 24)
    @Builder.Default
    private String processingStatus = "RECEIVED";

    @Column(name = "received_at", insertable = false, updatable = false)
    private Timestamp receivedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;
}
