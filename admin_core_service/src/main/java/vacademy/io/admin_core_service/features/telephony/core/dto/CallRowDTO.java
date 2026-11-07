package vacademy.io.admin_core_service.features.telephony.core.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

import java.sql.Timestamp;

/**
 * One row of the team calling dashboard. Provider-agnostic: AI (Aavtaar) and
 * human (Exotel/Airtel), inbound and outbound, all project to this shape.
 *
 * <p>{@code fromNumber}/{@code toNumber} are masked unless
 * {@link vacademy.io.admin_core_service.features.telephony.core.CallNumberVisibilityService}
 * says this caller's role may see full numbers. {@code leadNumber} is the
 * counterparty number (to_number on outbound, from_number on inbound), masked
 * under the same gate.
 *
 * <p>A masked value ({@code *******1234}) is DISPLAY TEXT — the digits are gone.
 * Consumers must not feed it to anything that dials, messages, or looks a person
 * up by phone; the dashboard checks for it before seeding the lead side-sheet.
 */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CallRowDTO {

    private String id;
    private String providerType;
    /** AI | HUMAN — derived, not stored. */
    private String callType;
    private String direction;
    private String status;
    private String terminationReason;

    private String fromNumber;
    private String toNumber;
    /** Counterparty (the lead's) number, masked under the same gate. */
    private String leadNumber;
    private String callerId;

    private Timestamp startTime;
    private Timestamp answerTime;
    private Timestamp endTime;
    private Integer durationSeconds;
    private boolean hasRecording;

    private String counsellorUserId;
    private String counsellorName;
    private String responseId;
    private String userId;
    private String leadName;

    /** IVR option the inbound caller chose, e.g. "1 · Shivir Info" (inbound IVR only). */
    private String ivrSelection;

    // Manual (human-set) disposition.
    private String dispositionKey;
    private String dispositionNotes;
    private Timestamp dispositionedAt;

    /** AI-call disposition from ai_call_result; null for non-AI calls. */
    private String aiDisposition;

    /**
     * Per-call technical health verdict — GREEN / AMBER / RED, or null when the
     * call reported none (a human call, an older bot, or a report that carried no
     * diagnostics). NULL MEANS NOT MEASURED and must never render as healthy.
     */
    private String diagHealth;

    /** Fault codes behind {@link #diagHealth}; null when not measured. */
    private java.util.List<String> diagFaults;

    /**
     * The counsellor's one-sentence answer to "do I call this lead myself?", shown
     * under the AI disposition. {@code followUpGist} is the sentence — the
     * recommendation and the concrete reason from the call. {@code followUp} is
     * CALL / CALL_LATER / SKIP and only colours it; it is never shown as a word.
     * NULL = NOT ASSESSED and must never be read as CALL.
     */
    private String followUp;
    private String followUpGist;
    /** Effective promised call-back time (human callback_at or AI callback_at). */
    private Timestamp callbackAt;

    private Timestamp createdAt;

    // ── Inline on the Call Log table since 2026-09-11 ────────────────────────
    /** The lead's pipeline status (audience_response.lead_status_id → lead_status); editable in the table. */
    private String leadStatusId;
    private String leadStatusKey;
    private String leadStatusLabel;
    private String leadStatusColor;
    /** call_intelligence.status (PENDING/TRANSCRIBING/ANALYZING/COMPLETED/FAILED/SKIPPED); null = never queued. */
    private String ciStatus;
    /** The analysis' two-line "what happened / what's next". */
    private String ciShortUpdate;
    private Double ciCallerRating;
    private Double ciOutcomeRating;
    private String ciLeadSentiment;
    private String ciConversionLikelihood;
    /** In-call actions: the agent promised a call-back / triggered a transfer. */
    private boolean aiCallback;
    private boolean transferred;
    /** Sends (WhatsApp/email) the AI call created, and how many actually went out. */
    private int sendsTotal;
    private int sendsSent;
}
