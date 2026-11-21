package vacademy.io.admin_core_service.features.telephony.spi.dto;

import lombok.Builder;
import lombok.Value;

import java.time.Instant;
import java.util.Map;

/**
 * Provider-neutral end-of-call outcome. Every AI-voice adapter's parser emits
 * this; the core (landing-zone persistence + outcome processor) only ever sees
 * this type. Richer than {@code NormalizedCallEvent} on purpose — it carries the
 * conversational outcome (disposition, Q&A, rating, summary, callback, transfer)
 * the assign-vs-retry decision needs.
 */
@Value
@Builder
public class AiCallReport {
    String provider;
    String callUuid;
    /** Our id echoed back in metadata on outbound calls. */
    String correlationId;
    String direction;          // INBOUND / OUTBOUND
    String campaignType;
    String campaignId;

    String status;             // raw provider status, e.g. "completed"
    Integer durationSeconds;
    Instant callStart;

    String disposition;
    String leadResponse;
    Integer leadRating;
    Integer callRating;
    String interestLevel;
    String summary;
    Map<String, Object> extractedQa;
    Map<String, Object> metadata;

    /**
     * Per-call technical diagnostics the voice bot emits as a top-level
     * {@code diagnostics} object (health verdict, fault codes, TTS/LLM/STT
     * latency, playout truth, turn-taking). Provider-optional: adapters that
     * have no such signal simply leave this null, and a null must never be read
     * as "healthy" — it means NOT MEASURED.
     */
    Map<String, Object> diagnostics;

    /**
     * The counsellor's one-sentence answer to "do I call this lead myself?" —
     * {@code followUpGist} is the sentence (recommendation + the concrete reason
     * from the call) and {@code followUp} is CALL / CALL_LATER / SKIP, used only to
     * colour and filter it. Not a grade of the assistant and not the disposition
     * restated. Provider-optional: a null followUp means NOT ASSESSED and must never
     * be read as CALL.
     */
    String followUp;
    String followUpGist;

    /**
     * Words the caller actually contributed, as MEASURED by the bot from the
     * transcript — not a model judgement. The outcome classifier uses it to route an
     * engaged-but-unjudged call to a human instead of retrying it. Null = the
     * provider did not measure it, which is NOT the same as zero.
     */
    Integer callerWordCount;

    String recordingUrl;
    String transcript;

    Boolean callbackRequested;
    Instant callbackAt;
    String callbackTimeText;

    Boolean transferAttempted;
    Boolean ninePressed;
    String transferStatus;
    String transferTriggered;

    String hangupCause;
    Integer hangupCode;
    String hangupSource;

    String phoneNumber;
    String dialCode;
    Integer callRetry;
    String customerName;
    String customerEmail;

    String rawPayload;
}
